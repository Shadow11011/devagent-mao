# PRIME-AGENT-INTEGRATION — fold Prime Agent into DevAgent MAO

> Fork `PrimeIntellect-ai/prime-agent`, vendor it into this repo, and graft its
> best capabilities onto MAO **without** replacing the two things that make MAO
> work. Prime Agent is a capability donor, not a new runtime.

## The decision in one line

MAO stays the brain, jcode stays the hands. Prime Agent gives us memory, skills,
and recursion — the three pieces MAO is missing.

## Why this shape (the honest read)

Prime Agent is a *better hand* than jcode for reasoning, and a *worse hand* for
parallel sandboxes. It is explicitly not a sandbox (same OS permissions), and it
is heavy per worker (Node + IPython kernel). MAO's own validation already said the
fix is "shed orchestrator tokens" — pulling Prime Agent's REPL-style RLM into the
default planner would *add* tokens and reopen the reprice problem.

So the integration preserves MAO's cost thesis:

- **Default path is unchanged:** K3 fires one tiny JSON plan per build; jcode
  workers write code in parallel; coupler + verifier run as today.
- **Memory is added cheaply:** OKF recall is a pre-prompt retrieval, not extra
  model turns. This attacks retries, MAO's #1 cost driver.
- **Skills are additive:** they run as shell/CLI calls, not extra model loops.
- **Recursion is gated:** it only fires when a plan's features themselves need
  decomposition, and it is opt-in, so it cannot silently bloat cost.

Net effect: MAO gets memory + skills + recursion while keeping jcode's RAM
advantage and Node's tested orchestration. That is the "both worlds" fit.

## What we take from Prime Agent (and only these three)

1. **Continual Harness design** -> rebuild MAO's own OKF memory (the moat,
   currently unbuilt).
2. **Python-backed skills** -> a reusable capability layer for workers + orchestrator.
3. **RLM recursive subagents** -> a gated, opt-in "recursive planning" mode.

Prime Agent's daemon-backed sessions, goals, heartbeats, schedules, and its TUI
are out of scope for this pass. We are not adopting Prime Agent's code for memory
either — we build MAO's own OKF using the Continual Harness *invariants*
(snapshots, evidence-backed refine, never rewrite the base prompt).

## Target layout

```
devagent-mao/
├── mao/                       <- orchestrator (Node, unchanged brain)
│   ├── src/
│   │   ├── okf/               <- NEW: MAO's own continual harness
│   │   │   ├── store.js        (markdown + frontmatter, snapshots, rollback)
│   │   │   ├── embed.js        (local embedding for similarity)
│   │   │   ├── recall.js       (two-step: embed -> candidates -> judge)
│   │   │   └── refine.js       (evidence-backed small updates, never rewrites base)
│   │   ├── skills.js          <- NEW: skill discovery + CLI console-script bridge
│   │   ├── recursive.js       <- NEW: gated RLM bridge (opt-in recursive planner)
│   │   ├── bridge.js          <- NEW: in-process AgentSession import / RPC fallback
│   │   ├── coordinator.js     (wire okf.recall + okf.record)
│   │   ├── planner.js         (accept real OKF_CONTEXT)
│   │   └── worker.js          (prepend recalled lessons)
│   └── prompts/               (unchanged core IP)
├── agent/                     <- jcode fork (unchanged worker)
├── prime-agent/               <- NEW: vendored fork (capability donor)
├── web/                       (unchanged UI)
└── validation/                (re-run gates)
```

## Phases

### Phase A — Fork, vendor, prove the bridge

1. Clone `PrimeIntellect-ai/prime-agent` into `devagent-mao/prime-agent/`, add it
   as a second `origin` (or subtree). Vendor it, do not fork into a separate repo,
   so cross-import is one workspace.
2. Strip what MAO doesn't need: TUI, verifiers, PRIME-RL/GPU training integration,
   telemetry. Keep: `coding-agent` core, skills, continual-harness primitives.
3. Build the vendored coding-agent package to importable JS/ESM.
4. **Proof gate:** `mao/test/bridge.test.js` imports `AgentSession` from the built
   fork and drives one headless turn. This must pass before anything else. If the
   import is too heavy (transitive deps fight MAO's zero-dep rule), fall back to
   `prime-agent --mode rpc` JSONL subprocess — the bridge is behind `bridge.js` so
   the swap is one file.

**Files:** `prime-agent/` (new), `mao/src/bridge.js` (new), `mao/test/bridge.test.js` (new)

### Phase B — OKF as MAO's own Continual Harness (the moat, first)

This is the highest-value work and MAO's biggest unbuilt gap. Build MAO's *own*
OKF, borrowing the Continual Harness invariants, not Prime Agent's code.

**Invariants (from Continual Harness, adapted to MAO):**
- OKF docs are portable markdown + YAML frontmatter (per `HARNESS-SPEC.md` section 6).
- `refine.js` makes small, evidence-backed updates; it **never rewrites** the base
  system prompt; every change is recorded with a snapshot for rollback.
- Dedup: similarity > 0.9 -> update existing doc, don't create a duplicate
  (already specified in `PROMPTS.md` `okf-writer`).
- Scope separation: `project` vs `global` from day 1 (`MOAT.md`).

**Store shape (all local, git-backed optional):**

```
data/okf/
  project/<repo-hash>/<problem_type>/<id>.md
  global/<problem_type>/<id>.md
  snapshots/<id>/<seq>.md          <- rollback points
  index.jsonl                     <- embedding index
```

**Wiring (the concrete integration points):**
- `coordinator.js` — before `planBuild`, call `okf.recall(task)` and pass the
  result as `OKF_CONTEXT` (today it is hardcoded `''`).
- `coordinator.js` / `buildFeature` — before each worker spawn, call
  `okf.recall(feature.description)` and prepend to the worker lesson (today only
  retry lessons reach the worker).
- `coordinator.js` / `finish()` — after success **and** failure, call
  `okf.record(rec)` to write/update the canonical OKF doc.
- `worker.js` — keep the `LESSON` variable but feed it from OKF recall + judge
  lesson, not judge lesson alone.

**Embedding decision:** use a lightweight local embedder (ONNX `bge-m3` int8)
inside `embed.js`. Do NOT couple OKF to the user's global memsearch/Milvus — OKF
is MAO-project-scoped and must stay self-contained/portable. memsearch can
optionally index `data/okf/global/` later; out of scope for this phase.

**Files:** `mao/src/okf/*.js` (new), edits to `coordinator.js`, `planner.js`, `worker.js`

### Phase C — Python-backed skills (capability layer)

Adopt Prime Agent's skills concept as a capability layer, but bridge it to jcode
(which is Rust, no Python kernel) via **CLI console scripts**.

- `skills.js` discovers `SKILL.md` in `.mao/skills/` and `~/.agents/skills/`,
  matching the Agent Skills spec (name/description frontmatter, `pyproject.toml`
  marks a Python-backed skill).
- A Python-backed skill declares a console script in `pyproject.toml`. jcode
  workers (which run bash) invoke it as `!<import_name> --args`, exactly the
  pattern in Prime Agent's skills doc.
- The orchestrator, if it needs a skill, uses the Phase A `bridge.js` to run it
  in the Prime Agent kernel.
- Skills become MAO's answer to "reusable capabilities" without requiring a
  Python runtime inside every jcode sandbox.

**Files:** `mao/src/skills.js` (new), `.mao/skills/` (new), `mao/test/skills.test.js` (new)

### Phase D — Gated recursive mode (RLM subagents)

Add recursion as an opt-in mode, not the default. This is the one place the RLM
reasoning actually enters MAO, and it is scoped so it cannot bloat cost by default.

- New `mao/src/recursive.js` exposes `recursivePlan(cfg, task, summary)` that
  drives the vendored Prime Agent `AgentSession` (or RPC fallback) to recursively
  decompose a task when the flat planner says a feature is still too big.
- Config gate: `MAO_RECURSIVE=1` or a `--recursive` flag. Off by default.
- `coordinator.js` checks the gate; when off, the pipeline is byte-for-byte the
  current one. When on, `recursive.js` runs *before* `planner.js` to split coarse
  features into leaf features, then the normal wave/couple/verify path runs
  unchanged.
- Recursion depth is capped (default 1 level) so it never becomes unbounded.

**Files:** `mao/src/recursive.js` (new), edit `coordinator.js` (gate check), `mao/src/config.js` (add `recursive` flag)

### Phase E — Re-run validation (proof)

The gate is unchanged from `VALIDATION.md`. Re-run the 10-task, two-arm protocol
to prove the integration did not regress correctness or cost.

**What changes in this run vs the last:**
- OKF recall is wired in (does it reduce worker attempts? the moat proof).
- Recursive mode is exercised on `t6` and `t10` (canonical multi-feature and the
  high-effort stand-in) and compared against the flat planner.
- Python-backed skills are smoke-tested on at least one task (e.g. a search or
  doc-parse capability).

**Gate to pass (from VALIDATION.md):**
- Merge success >= 70% (last run: 90%).
- Cost ratio improves toward <= 15% of single-model (last run: 0.63, which
  triggered REPRICE — the OKF recall must help close this gap).
- New success metric: OKF recall should reduce worker attempt count per feature
  vs the no-memory baseline.

**Output:** update `VALIDATION-RESULTS.md` with the post-integration numbers and a
new go/no-go note.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Vendored TS monorepo pulls heavy deps, fighting MAO's zero-dep rule | Phase A proof gate first; `bridge.js` keeps an RPC-subprocess fallback behind one interface |
| "In-process import" too heavy for zero-dep Node | Fall back to `--mode rpc` JSONL |
| OKF needs an embedding model and adds infra | Local ONNX bge-m3 int8, no external service; index stays plain JSONL |
| Recursive mode reopens the cost/reprice problem | Gated off by default, depth-capped, measured only in Phase E |
| jcode workers can't run Python skills | Skills expose CLI console scripts; jcode calls them via bash, no kernel needed |

## Verification (end to end)

1. `mao/test/bridge.test.js` green — vendored Prime Agent drives one headless turn in-process.
2. `mao/test/okf/*.test.js` green — store/recall/refine/dedup/snapshot/rollback, all with mock embeddings.
3. `mao/test/skills.test.js` green — discovery + console-script invocation.
4. `mao/test/recursive.test.js` green — gate off = unchanged plan; gate on = coarse features split into leaves.
5. Full `validation/runner.js` re-run: merge >= 70%, cost ratio <= 15%, worker-attempt reduction with OKF on.
6. Existing `mao/test/*` and `web/test/*` suites stay green (no regressions to the untouched coordinator path).

## Out of scope (this plan)

- Real sandbox isolation (microVM/Shiro engines) — unchanged, still a Phase 3 gap.
- Daemon-backed sessions, goals, heartbeats, schedules — deferred; the web UI's
  long-running story is a separate effort.
- Hosted tier, billing, Tauri shell.
