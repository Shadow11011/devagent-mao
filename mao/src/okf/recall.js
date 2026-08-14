// Two-step OKF recall: embed the query -> candidates -> the caller (worker) judges
// which candidates actually apply. This keeps the orchestrator's token budget
// flat: retrieval here is a local similarity pass, not a model turn.

import { cosine } from './embed.js';

export function createRecall({ store, embedFn, topN = 5 }) {
  return {
    // Return ranked candidates (top-N by similarity) for a query. Does NOT make
    // a relevance judgment — the worker/planner does that, matching HARNESS-SPEC
    // "mini-model is the relevance judge, not the index". When scope is
    // 'project', `repo` (already-hashed repo id) must also match so lessons from
    // one codebase never leak into another (MOAT.md: project lessons are the moat).
    recall(query, { scope = null, repo = null, topK = topN } = {}) {
      const target = embedFn(query);
      const scored = store
        .allDocs()
        .filter((doc) => {
          if (scope && doc.scope !== scope) return false;
          if (scope === 'project' && repo && doc.repo !== repo) return false;
          return true;
        })
        .map((doc) => ({ doc, sim: cosine(embedFn(doc.text), target) }))
        .sort((a, b) => b.sim - a.sim);
      return scored.slice(0, topK).map(({ doc, sim }) => ({ doc, sim }));
    },

    // Convenience: render top-N candidates into the OKF_CONTEXT text handed to
    // the planner or worker prompt.
    formatContext(query, { scope = null, repo = null, topK = topN } = {}) {
      const hits = this.recall(query, { scope, repo, topK });
      if (!hits.length) return '';
      return hits.map(({ doc, sim }) => {
        const heading = `# ${doc.problemType} (${doc.scope}, sim ${sim.toFixed(2)})`;
        return `${heading}\n${doc.body}`;
      }).join('\n\n---\n\n');
    },
  };
}
