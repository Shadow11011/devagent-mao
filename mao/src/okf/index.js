// OKF memory: MAO's own Continual Harness. Public API.
//
// Usage:
//   const okf = createOkf({ root: '/path/to/data/okf' });
//   const ctx = okf.recall.formatContext(task);
//   const doc = okf.record({ scope: 'project', repo, problemType, evidence });
//
// The embedder is injectable. Default is the zero-dep character/word hash in
// embed.js; swap in ONNX bge-m3 int8 later by passing `embedFn` (must be async or
// sync and return a number[]).

import { createOkfStore } from './store.js';
import { createRecall } from './recall.js';
import { createRefine } from './refine.js';
import { defaultEmbedFn } from './embed.js';

export function createOkf({ root, embedFn, dims = 256, topN = 5 }) {
  const embed = embedFn ?? defaultEmbedFn(dims);
  const store = createOkfStore({ root, embedFn: embed });
  const recall = createRecall({ store, embedFn: embed, topN });
  const refine = createRefine({ store });

  return {
    root,
    store,
    recall,
    refine,

    // Convenience: recall relevant lessons for a query and return them as the
    // OKF_CONTEXT text consumed by planner.v1 / worker.v1. For project-scoped
    // recall, `repo` is the already-hashed repo id (store.repoHash(sourceDir)).
    recallContext(query, { scope = null, repo = null, topK = topN } = {}) {
      return recall.formatContext(query, { scope, repo, topK });
    },

    // Convenience: record a build outcome as a canonical OKF doc.
    record({ scope, repo, problemType, evidence }) {
      return refine.recordOutcome({ scope, repo, problemType, evidence });
    },
  };
}

export { repoHash, slugify } from './store.js';
export { defaultEmbedFn, embedText, cosine } from './embed.js';
