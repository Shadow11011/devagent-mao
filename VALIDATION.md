# VALIDATION — the experiment that gates Phase 1

> The entire MAO thesis rests on one unproven claim: **an orchestrator can split a real coding task into parallel features that cheap workers build in isolation and a coupler merges cleanly.** If that fails, nothing else matters. Run this BEFORE building the orchestrator.

## The question

Can Kimi K3 decompose a task into 2-5 features such that:
1. V4 Flash workers build each feature correctly in isolation (scoped files only),
2. overlapping-file coupling (V4 Flash, escalating to K3) produces compiling, test-passing code,
3. total cost stays under $2/build and beats single-model quality?

## Protocol — 10 experiments

### Tasks (real, varied)

| # | Task | Why it's a good test |
|---|------|----------------------|
| 1 | Express auth module (JWT + bcrypt + middleware) | Multi-file, shared entry point, classic |
| 2 | REST CRUD API (3 resources, shared router) | Tests wave ordering (resource deps) |
| 3 | React component set (form + list + detail, shared state) | Frontend, shared context file |
| 4 | CLI tool (3 subcommands, shared main + config) | jcode's natural habitat |
| 5 | Data pipeline (fetch → transform → store, staged) | Forces wave dependencies |
| 6 | Auth + dashboard + payments (the canonical 3-feature build) | The headline demo |
| 7 | Add feature to EXISTING real repo (500+ files) | File-scoping stress test |
| 8 | Bugfix across 3 coupled files | Small-scope sanity |
| 9 | Feature with test requirement (pytest/jest must pass) | Quality gate + verification |
| 10 | Same as #6 but BYOK Fable 5 orchestrator | Does the smart orchestrator change outcomes? |

### Per experiment, run BOTH arms

- **Arm A — MAO:** K3 plan → V4 Flash workers (scoped) → V4 Flash couple → verify (build+test)
- **Arm B — Single model:** same task, one frontier model (K3 or Fable 5), full repo access, no split

### Measure

| Metric | How |
|--------|-----|
| Correctness | build passes? tests pass? feature works? |
| Merge conflicts | # of overlapping files needing manual fix after coupling |
| Coupling success | V4 Flash coupled cleanly, or needed K3, or failed |
| Token cost | per arm, per model, total $ |
| Wall-clock | end to end, both arms |
| Plan quality | were the feature splits sensible? (human judgment, 1-5) |
| Wave correctness | did it correctly identify dependencies? |

### Kill / pivot criteria

| Outcome | Decision |
|---------|----------|
| Merge success ≥ 70% AND cost ≤ 15% of single-model | **GO.** Build Phase 2. |
| Merge success 40-70% | Coupling needs K3 always, or features need smaller scope. Redesign coupling, re-run 6/7/9. |
| Merge success < 40% | **Architecture rework.** Consider: single-worker builds with OKF memory only (no parallel split), or sequenced-not-parallel builds. |
| Plans are bad (avg plan quality ≤ 2) | Prompt engineering phase first — [PROMPTS.md](PROMPTS.md) before any code. |
| Correct but cost ≥ 30% of single-model | Thesis still holds at 3x cheaper but "6%" claim dies. Reprice the hosted tier, adjust marketing. |

## Output

`VALIDATION-RESULTS.md` with per-experiment data, then the go/no-go decision recorded in this repo. No Phase 2 code before this exists.
