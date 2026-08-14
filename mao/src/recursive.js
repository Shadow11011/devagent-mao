// Recursive planning (RLM-style) — opt-in and gated off by default.
//
// The flat planner splits a task into features for one worker each. When a
// feature is still too big for one worker, recursive mode decomposes it into
// leaf features before the normal wave/couple/verify path runs unchanged.
//
// Two seams keep this testable without a live model:
//   - isCoarseFeature is a deterministic size signal (no model call).
//   - decomposeFeature is injected. The production default asks the orchestrator
//     model via a dedicated prompt; tests inject a fake decomposer.
//
// The Prime Agent AgentSession (Phase A bridge) is an alternative decomposer,
// not required here — MAO's orchestrator already plans; recursion only needs a
// finer split of one coarse feature, which the same orchestrator model can do.

import { chatJson } from './modelClient.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { scheduleWaves } from './planner.js';

// A feature is "coarse" when it clearly exceeds one worker's comfortable size.
export function isCoarseFeature(feature, opts = {}) {
  const maxNewFiles = opts.maxNewFiles ?? 4;
  const maxFiles = opts.maxFiles ?? 6;
  const maxDescriptionChars = opts.maxDescriptionChars ?? 600;
  return feature.tooBig === true ||
    (feature.newFiles?.length ?? 0) > maxNewFiles ||
    (feature.files?.length ?? 0) > maxFiles ||
    (feature.description?.length ?? 0) > maxDescriptionChars;
}

// Split a coarse feature into ordered leaf features. Leaves are chained
// sequentially (leaf N depends on leaf N-1) so a decomposed feature is always
// built in a safe order; each leaf inherits the parent's external dependencies.
// This is conservative: within one coarse feature the leaves do not run in
// parallel, but each leaf is smaller, cheaper to retry, and gets its own OKF
// lesson — the point of recursion is correctness, not extra parallelism.
export function splitFeature(feature, children) {
  return (children ?? []).map((child, i) => {
    const deps = new Set(feature.dependencies ?? []);
    if (i > 0) deps.add(`${feature.id}-${i}`);
    return {
      id: `${feature.id}-${i + 1}`,
      description: child.description,
      files: child.files ?? feature.files ?? [],
      newFiles: child.newFiles ?? [],
      dependencies: [...deps],
      parent: feature.id,
    };
  });
}

// Recursively decompose coarse features into leaves, depth-capped. Returns a new
// plan with remapped dependencies and rescheduled waves. When nothing is coarse,
// the plan is returned structurally unchanged (same features array reference).
export async function recursivePlan(plan, { decomposeFeature, isCoarse = isCoarseFeature, maxDepth = 1 }) {
  const features = plan.features ?? [];
  const childrenOf = new Map(); // parent feature id -> leaf ids it was split into
  const leaves = [];
  let splitAnything = false;

  async function process(feature, depth) {
    const shouldSplit = depth < maxDepth && isCoarse(feature);
    if (!shouldSplit) { leaves.push(feature); return; }
    const children = await decomposeFeature(feature, depth);
    if (!Array.isArray(children) || !children.length) { leaves.push(feature); return; }
    splitAnything = true;
    const split = splitFeature(feature, children);
    childrenOf.set(feature.id, split.map((c) => c.id));
    for (const child of split) await process(child, depth + 1);
  }

  for (const f of features) await process(f, 0);

  if (!splitAnything) return { ...plan, features, waves: plan.waves ?? scheduleWaves(features) };

  // Remap external dependencies: any dependency that was itself split expands to
  // its leaf ids. Intra-feature chain deps are already leaf ids and pass through.
  const remapped = leaves.map((f) => {
    const deps = [];
    for (const d of f.dependencies ?? []) {
      if (childrenOf.has(d)) deps.push(...childrenOf.get(d));
      else deps.push(d);
    }
    return { ...f, dependencies: [...new Set(deps)] };
  });

  return {
    ...plan,
    features: remapped,
    sharedFiles: plan.sharedFiles ?? [],
    waves: scheduleWaves(remapped),
  };
}

const RECURSIVE_SCHEMA = {
  type: 'object',
  properties: {
    features: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
        },
        required: ['description'],
        additionalProperties: false,
      },
    },
  },
  required: ['features'],
  additionalProperties: false,
};
const RECURSIVE_JSON_FORMAT = { type: 'json_schema', json_schema: { name: 'recursive_decompose', strict: true, schema: RECURSIVE_SCHEMA } };

// Production decomposer: ask the orchestrator model to split ONE coarse feature
// into ordered leaf steps. Returns a `decomposeFeature(feature, depth)` function.
export function decomposeFeatureWithOrchestrator(cfg) {
  return async function decomposeFeature(feature) {
    const system = renderPrompt(loadPrompt('recursive.v1'), {
      FEATURE_DESCRIPTION: feature.description,
      FILES_LIST: (feature.files ?? []).map((f) => `- ${f}`).join('\n') || '(none)',
      NEW_FILES_LIST: (feature.newFiles ?? []).map((f) => `- ${f}`).join('\n') || '(none)',
    });
    const r = await chatJson(cfg.models.orchestrator, {
      messages: [{ role: 'system', content: system }],
      jsonFormat: RECURSIVE_JSON_FORMAT,
      validate: (o) => {
        if (!Array.isArray(o.features) || !o.features.length) throw new Error('features must be a non-empty array');
        for (const f of o.features) if (!f.description || !String(f.description).trim()) throw new Error('every feature needs a description');
        return o;
      },
      apiKey: cfg.apiKey,
      timeoutMs: cfg.requestTimeoutMs,
    });
    return r.value.features;
  };
}
