import { chatJson } from './modelClient.js';
import { loadPrompt, renderPrompt } from './prompts.js';

export const COUPLE_SCHEMA = {
  type: 'object',
  properties: {
    merged: { type: 'string' },
    conflicts: { type: 'array', items: { type: 'string' } },
  },
  required: ['merged', 'conflicts'],
  additionalProperties: false,
};
export const COUPLE_JSON_FORMAT = { type: 'json_schema', json_schema: { name: 'couple', strict: true, schema: COUPLE_SCHEMA } };

export async function coupleFile(cfg, { path, original, variants, effort = null }) {
  if (variants.length === 1) return { content: variants[0].content, conflicts: [], escalated: false, usage: { prompt: 0, completion: 0, total: 0, cached: 0 } };
  const variantsBlock = variants.map((v, i) => `VARIANT ${i + 1} (feature "${v.featureId}", intent: ${v.intent}):\n${v.content}`).join('\n\n---\n\n');
  const system = renderPrompt(loadPrompt('coupler.v1'), { PATH: path, ORIGINAL: original || '(file did not exist before)', VARIANTS_BLOCK: variantsBlock });
  const ask = (extraUser, e) => chatJson(cfg.models.orchestrator, {
    messages: [{ role: 'system', content: system }, ...(extraUser ? [{ role: 'user', content: extraUser }] : [])],
    jsonFormat: COUPLE_JSON_FORMAT,
    validate: (o) => { if (typeof o.merged !== 'string' || !o.merged.length) throw new Error('empty merged'); return o; },
    reasoningEffort: e ?? effort ?? cfg.models.orchestrator.reasoningEffort,
    apiKey: cfg.apiKey, timeoutMs: cfg.requestTimeoutMs,
  });
  const first = await ask(null, null);
  if (!first.value.conflicts.length) return { content: first.value.merged, conflicts: [], escalated: false, usage: first.usage };
  const second = await ask(`Conflicts reported: ${JSON.stringify(first.value.conflicts)}. Resolve them now, keeping BOTH intents; return the final file with zero conflicts.`, 'high');
  return { content: second.value.merged, conflicts: second.value.conflicts, escalated: true, usage: addU(first.usage, second.usage) };
}

function addU(a, b) { return { prompt: a.prompt + b.prompt, completion: a.completion + b.completion, total: a.total + b.total, cached: a.cached + b.cached }; }
