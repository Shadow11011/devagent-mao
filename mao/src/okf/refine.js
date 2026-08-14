// Evidence-backed OKF refinement. This is the Continual Harness invariant adapted
// to MAO: refine makes small updates that record evidence; it NEVER rewrites the
// base system prompt or a canonical lesson. Every change goes through the store,
// which snapshots the previous version for rollback.

export function createRefine({ store }) {
  return {
    // Write (or update) a canonical OKF doc from a build outcome. `evidence`
    // is the structured facts backing the lesson: what was attempted, what
    // worked, what failed, and the reusable takeaway.
    recordOutcome({ scope, repo, problemType, evidence }) {
      const { attempted, worked, failed, lesson } = evidence ?? {};
      const body = [
        '# What was attempted',
        attempted || '(not recorded)',
        '',
        '# What worked',
        worked || '(none recorded)',
        '',
        '# What failed',
        failed || '(none recorded)',
        '',
        '# Reusable lesson',
        lesson || '(none recorded)',
      ].join('\n');

      const meta = {
        type: evidence?.failed ? 'failure' : 'solution',
        ...(evidence?.stack ? { stack: evidence.stack } : {}),
        ...(evidence?.model ? { model: evidence.model } : {}),
        ...(evidence?.environment ? { environment: evidence.environment } : {}),
      };

      return store.record({ scope, repo, problemType, body, meta });
    },
  };
}
