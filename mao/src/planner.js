import { chatJson } from './modelClient.js';
import { loadPrompt, renderPrompt } from './prompts.js';

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          description: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          newFiles: { type: 'array', items: { type: 'string' } },
          dependencies: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'description', 'files', 'newFiles', 'dependencies'],
        additionalProperties: false,
      },
    },
    sharedFiles: { type: 'array', items: { type: 'string' } },
    waves: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  },
  required: ['features', 'waves'],
  additionalProperties: false,
};

export const PLAN_JSON_FORMAT = { type: 'json_schema', json_schema: { name: 'plan', strict: true, schema: PLAN_SCHEMA } };

export function validatePlan(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.features)) throw new Error('plan.features missing');
  if (raw.features.length === 0) throw new Error('plan.features empty');
  const seen = new Set();
  for (const f of raw.features) {
    for (const k of ['id', 'description']) if (typeof f[k] !== 'string' || !f[k]) throw new Error(`feature missing ${k}`);
    for (const k of ['files', 'newFiles', 'dependencies']) if (!Array.isArray(f[k])) throw new Error(`feature ${f.id}: ${k} must be array`);
    if (seen.has(f.id)) throw new Error(`duplicate feature id: ${f.id}`);
    seen.add(f.id);
  }
  for (const f of raw.features) for (const d of f.dependencies) if (!seen.has(d)) throw new Error(`unknown dependency: ${d} in ${f.id}`);
  const waves = (Array.isArray(raw.waves) && wavesTrustworthy(raw)) ? raw.waves : scheduleWaves(raw.features);
  return { features: raw.features, sharedFiles: Array.isArray(raw.sharedFiles) ? raw.sharedFiles : [], waves };
}

// Trust K3's waves only if (a) they contain exactly the feature ids with no duplicates
// and (b) every dependency sits in an earlier-or-equal wave index. Otherwise reschedule.
function wavesTrustworthy(raw) {
  const flat = raw.waves.flat();
  const featureIds = new Set(raw.features.map((f) => f.id));
  if (flat.length !== raw.features.length || new Set(flat).size !== flat.length || !flat.every((id) => featureIds.has(id))) return false;
  const waveOf = new Map();
  raw.waves.forEach((wave, i) => wave.forEach((id) => waveOf.set(id, i)));
  for (const f of raw.features) for (const d of f.dependencies) if (waveOf.get(d) > waveOf.get(f.id)) return false;
  return true;
}

export function scheduleWaves(features) {
  const deps = new Map(features.map((f) => [f.id, new Set(f.dependencies)]));
  const waves = [];
  let remaining = new Set(deps.keys());
  while (remaining.size) {
    const ready = [...remaining].filter((id) => [...deps.get(id)].every((d) => !remaining.has(d)));
    if (!ready.length) throw new Error(`dependency cycle among: ${[...remaining].join(', ')}`);
    ready.sort();
    waves.push(ready);
    for (const id of ready) remaining.delete(id);
  }
  return waves;
}

export async function planBuild(cfg, { summary, okfContext = '', prompt, effort = null }) {
  const system = renderPrompt(loadPrompt('planner.v1'), { PROJECT_SUMMARY: summary, OKF_CONTEXT: okfContext || '(none)' });
  const r = await chatJson(cfg.models.orchestrator, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    jsonFormat: PLAN_JSON_FORMAT,
    validate: validatePlan,
    reasoningEffort: effort ?? cfg.models.orchestrator.reasoningEffort,
    apiKey: cfg.apiKey,
    timeoutMs: cfg.requestTimeoutMs,
  });
  return { plan: r.value, usage: r.usage, attempts: r.attempts };
}
