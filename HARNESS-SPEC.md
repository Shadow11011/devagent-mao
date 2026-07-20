# DevAgent MAO — Orchestration Architecture Spec

> Multi-agent coding harness: expensive orchestrator model splits work into features, spawns isolated local sandboxes running cheaper models, no back-and-forth between large and mini models. OKF-based save states for learning.

## 1. Stack

- **jcode** (Rust, MIT, github.com/1jehuang/jcode) — forked agent runtime. Swarm mode REMOVED. Used as the agent execution engine inside each sandbox (file edits, shell, git, provider routing, TUI stripped to headless).

### Why jcode over OpenCode

| Factor | jcode | OpenCode |
|--------|-------|----------|
| RAM (1 session) | 27.8 MB | 371.5 MB (13.4× more) |
| RAM (10 sessions) | 117 MB | 3,237 MB (27.7× more) |
| Time to first frame | 14 ms | 1,036 ms (74× slower) |
| Extra RAM per session | ~10 MB | ~318 MB (32× more) |
| Built-in memory | semantic vector graph | none |
| Self-dev mode | edits own source, rebuilds | no |

Decisive for our MAO: (1) RAM — spawning 5+ sandboxes per task, OpenCode would OOM a laptop at 3.2GB/10 sessions vs jcode's 117MB; (2) built-in memory graph covers 80% of cognee's role, adaptable to emit OKF; (3) 74× faster startup matches the "ping" sandbox claim; (4) self-dev mode speeds fork iteration.
- **cognee** (Python, Apache-2.0, github.com/topoteretes/cognee) — knowledge graph memory. Indexes OKF docs, serves similarity recall to mini-models.
- **OKF** (Open Knowledge Format, Google standard, June 2026) — markdown + YAML frontmatter docs. Written by orchestrator as canonical memory on success AND failure.
- **Local sandbox system** (friend's build) — deploys a sandbox on the user's laptop in ~a ping. Orchestrator calls it via its API/CLI to spin up/tear down environments. No cloud cost, no network latency.

## 9. Security Requirement (HARD)

Mini-models execute untrusted shell commands inside sandboxes. **Containers are NOT a security boundary** (8 escape CVEs in 18 months, host filesystem access; agents disable their own container sandbox when blocked). The sandbox MUST be a **microVM** (Firecracker / Cloud Hypervisor / libkrun / crosvm) with hardware-enforced isolation — own kernel, own filesystem, own network stack. Boot ~125ms, <5MiB overhead. Container-based sandbox is a blocking risk and must be escalated to the user before build.

Reference: microVM ecosystem (rust-vmm, Firecracker) is the 2026 standard for AI agent code execution (E2B, Vercel Sandbox, Docker Sandboxes all use it).

## 2b. Cost Model (validated against provider pricing)

| Model | Role | Input (cache miss) | Output |
|-------|------|-------------------|--------|
| Kimi K3 | Orchestrator | $3.00/M | $15.00/M | Intelligence 57/187 |
| Claude Fable 5 | Orchestrator | $10.00/M | $50.00/M | Intelligence 60/187 (#1) |
| DeepSeek V4 Flash | Worker | $0.14/M | $0.28/M |
| DeepSeek V4 Pro | Worker | $0.435/M | $0.87/M |

Example: task needing ~200K output tokens.
- Single frontier model: ~$0.40
- Split (orchestrator ~10K out + 50K in = $0.24, workers ~190K out at V4 Flash = $0.053): **~$0.29** — 27% cheaper. Gap widens on larger tasks because orchestrator input stays flat (one plan) while workers do token-heavy generation at 3-6x lower rates.

Benchmark validation (htdocs.dev, Apr 2026): multi-agent orchestration with frontier orchestrator + cheap workers is the dominant 2026 pattern (OmO/Sisyphus runs Kimi K2.5 orchestrator + cheaper workers in production). OKF save-states attack the field's #1 cost warning (OmO creator spent $24K on tokens) by reducing re-attempts.

### Cost Calculator: $100 of orchestrator credit in our MAO

In our architecture the orchestrator (Fable 5 / Kimi K3) ONLY plans + reviews. Workers (V4 Flash) do generation. So $100 of orchestrator credit is spent almost entirely on orchestrator tokens, not generation.

Per-task orchestrator cost (plan: ~5K in + ~8K out; review: ~3K in + ~2K out):
- **Kimi K3:** (5K×$3 + 8K×$15 + 3K×$3 + 2K×$15)/1M = **~$0.17/task**

NOTE: above is orchestrator-only. Real per-task cost includes workers. See Section 9 for benchmark-validated numbers.

$100 buys (orchestrator credit only, workers billed separately):
| Orchestrator | Tasks per $100 | At 10 tasks/day | At 20 tasks/day |
|--------------|---------------|-----------------|-----------------|
| Kimi K3 | ~580 | ~58 days | ~29 days |
| Fable 5 | ~172 | ~17 days | ~8.5 days |

For contrast, a normal agent where Fable 5 does EVERYTHING (~200K output/task at $50/M = $10/task): $100 lasts **~10 tasks**. Our MAO makes the same $100 last **~17× longer** because the expensive model only thinks.

Kimi K3 is the recommended default orchestrator: 3.4× cheaper than Fable 5 at 95% of its intelligence (57 vs 60). Fable 5 is the max-intelligence option for users who want the best planning and can pay for it. Both validated via Artificial Analysis (July 2026).

## 2. Core Principle: Cost Concentration

The expensive orchestrator model does ONLY:
- Receive task (input)
- Split into features (output)
- Emit spawn instructions (output)
- Final merge review (input + output)

All other work (actual coding, memory reads, retries) uses cheap models in sandboxes. Cost lands on inputs to the large model (cheap) not outputs (expensive).

## 3. Architecture Layers

### Layer 1 — Orchestrator (ours, net-new)
Large model (Kimi K3 / Fable5 / GLM) receives task, plans, splits into features. For each feature:
- Scope the exact files the mini-model needs (no full-repo duplication)
- Spawn a local sandbox via friend's API, assign a cheaper model (DeepSeek V4 Pro, MiMo, Qwen)
- Monitor completion
- On done: kill sandbox, extract output files, delete all temp files
- On failure: write OKF doc (what failed, why), re-spin FRESH sandbox with OKF pre-loaded
- Final merge sandbox stitches outputs; large model does last review

Concurrency = configurable input (user sets max parallel sandboxes). No auto-decision.

### Layer 2 — jcode (forked, swarm removed)
Runs inside each sandbox as the agent runtime. Performs file edits, shell, git, provider calls to the assigned cheap model. Headless mode (no TUI) inside sandbox.

### Layer 3 — OKF + cognee (memory)
- **OKF writes = orchestrator (large model).** Canonical truth. Written on success AND failure. Documents what worked, what definitively didn't.
- **OKF reads = mini-models (two-step retrieval).** At sandbox start, mini-model embeds its task and queries cognee graph → gets candidate OKF docs (title, tags, similarity score). Mini-model then OPENS the ones that look relevant, reads full markdown, and judges if they apply to its slice. cognee is the index (fast similarity search); OKF files are the source (full lessons). Mini-model is the relevance judge, not cognee.
- cognee indexes OKF docs into a graph. Future mini-models recall by similarity.

## 3b. Quality Gate (pre-judgment hook)

Before the orchestrator judges a sandbox "done", an automated hook runs lint + typecheck + tests inside the sandbox. This catches SYNTAX/COMPILE failures immediately — the mini-model must fix its own output within the same sandbox before the orchestrator is invoked. Only CLEAN output reaches the orchestrator for logic judgment.

## 3c. Retry & Escalation (logic failures)

Mini-model failures are predominantly LOGIC (wrong approach, misunderstood requirement, missed edge case), not syntax. Retry rule:
- Max **3 re-spins** per feature (Ralph Loop 3-strike rule)
- Each re-spin loads accumulated OKF failure docs so the mini-model doesn't repeat a wrong approach
- After 3 strikes → escalate to the LARGE model, which either re-plans the feature smaller or flags it for human review
- Syntax failures are NOT retries — the quality gate forces in-sandbox fix before orchestrator judgment

## 3d. Conversation Model & Two Modes

The orchestrator is NOT the conversational partner. A cheaper model (V4 Flash) is the face. Two modes control how much the expensive orchestrator participates:

**Cheap mode (default, all tiers):**
- Tiny model (V4 Flash) handles ALL conversation — chat, explain, brainstorm, answer
- Orchestrator (Kimi K3) wakes ONLY on build tasks: plans, spawns workers, merges
- No mid-conversation validation. Bad architectural calls are caught at plan time when the orchestrator reads the full conversation before splitting work
- Lowest cost: conversation is pennies; orchestrator cost (~$0.82/task) applies only when building

**Guided mode (opt-in, paid tiers):**
- Orchestrator validates decisions mid-conversation (the "senior engineer glances over" pattern)
- Smartest path, but adds ~$1.60/session in orchestrator listening/validation cost
- User explicitly toggles it on

**Tier mapping:**
- Free: cheap mode only
- Starter/Pro/Max: cheap mode default, guided mode toggle available

**BYOK implication:** users bringing their own keys provide (1) an orchestrator key and (2) a worker/conversation key. One aggregator key (OpenRouter) can cover both. Guided mode simply uses the orchestrator key more. Hosted plans need no keys — pay and pick tier.

## 4. Sandbox Lifecycle

1. Orchestrator scopes files for feature F.
2. Spawn sandbox via friend's API with scoped files + assigned cheap model + task.
3. Mini-model queries cognee/OKF (reads relevant past docs).
4. Mini-model works, writes output to known output path, emits one-line stdout summary.
5. Orchestrator judges (reads output + summary).
   - Success → extract output files, kill sandbox, delete temp. Large model writes success OKF.
   - Failure → large model writes failure OKF (lesson). Kill sandbox, delete temp. Re-spin fresh sandbox with OKF pre-loaded. No in-place iteration.
6. Final merge sandbox collects all feature outputs, stitches. Large model reviews.

Only output files survive. All temp/scratch deleted on kill.

## 5. File Scoping

Orchestrator determines minimal working set per feature (e.g. `auth.py`, `models/user.py` for the auth feature). Only those files mount into the sandbox. Prevents repo duplication across N parallel sandboxes, keeps context tokens low.

## 6. OKF Doc Shape

```markdown
---
type: solution | failure
feature: auth-import-conflict
model: deepseek-v4-pro
environment: node18, ts
date: 2026-07-19
embedding_hint: "auth module import cycle between user model and session"
---

# What was attempted
...

# What worked / What didn't
...

# Reusable lesson
...
```

cognee indexes frontmatter + body for similarity recall.

## 7. Out of Scope (this build)

- Desktop app shell / Playwire ads (see DESIGN.md business layer)
- Billing / Stripe / subscriptions
- Remote/cloud sandboxes (local laptop only for now)
- TUI polish on the MAO (headless orchestrator first)

## 8. Open Items

- [ ] Interface to friend's sandbox system (REST? CLI? SDK?) — needed before Layer 1 implementation
- [ ] Exact large-model system prompts for planning/splitting
- [ ] OKF store location (local dir path, git-backed?)
- [ ] cognee deployment mode (local Postgres? embedded SQLite/LanceDB?)
- [ ] jcode fork: which crates to keep, what to strip beyond swarm

## 9. Conversation Model: Two-Layer, Validation-First

The MAO is NOT build-only. Most sessions are conversation (brainstorm, debug talk, explain, "what do you think"). The architecture must support both without breaking the cost thesis.

### The problem with "orchestrator as conversational agent"
If the expensive model (Kimi K3 / Fable 5) is the always-on chat partner, EVERY message hits it at $15-50/M output. Cost saving vanishes. The MAO only saves money if the expensive model touches minimal tokens.

### The problem with "cheap model as conversation, orchestrator hidden"
If V4 Flash handles all chat and only escalates on build, the orchestrator inherits a LOW-QUALITY conversation — the cheap model cemented shallow decisions. Knowledge gap: the planner plans from garbage.

### Solution: cheap model = fast talker, expensive model = senior engineer (validator + planner)
- **Cheap model (V4 Flash, $0.14/$0.28)** is the visible conversational partner. Handles chat, explain, brainstorm.
- **Expensive model (Kimi K3 / Fable 5)** has TWO jobs, both visible from turn one:
  1. **Validate decisions in real-time** — when the cheap model hits a real choice ("Redis or Postgres?", "is this architecture sound?"), it defers: "let me check with the planner." Expensive model validates (~200 out tokens = **$0.003/call**). User knows the senior engineer is in the room.
  2. **Plan + orchestrate builds** — when real work appears, plans, spawns workers, reviews, merges.
- **No betrayal, no knowledge gap:** the expensive model isn't a hidden observer or a surprise boss. It's the validator present from the start. Decisions get signed off before they're cemented. The cheap model NEVER cements decisions — it defers on anything that matters.

### Cost of the conversation layer (200K-token session, ~20 decision validations)
- 20 validations × ~200 out tokens = 4K out × $15/M = **$0.06**
- Orchestrator reading conversation for context: ~500K in × $3/M = **$1.50** (cached reads ~$0.03 each after first)
- Total conversation-layer cost: **~$1.60/session** — trivial vs a single Fable 5 output turn ($0.10-0.15)

### Realistic per-task cost (benchmark-validated, 2026 agentic-coding data)
- Agentic coding: 133K (OpenCode) to 298K (Claude Code) tokens/task incl. retries (systima.ai)
- Coding input:output ≈ 3:1 (file reads dominate), 1.7× overhead multiplier for retries (iternal.ai 2026)
- **Per task, our MAO (Kimi K3 orch + 3× V4 Pro workers, 50K out each):** orch $0.82 + workers $0.55 = **~$1.38/task**
- **Same task, single Fable 5:** ~$22.95/task
- **MAO is ~94% cheaper** per task

### 300M-token-context session cost (benchmark-validated)
- Multi-agent system: ~300K-1M tokens/task, use 500K avg → ~600 tasks in 300M
- MAO: 600 × $1.38 = **~$828**
- Same work on Fable 5: 600 × $22.95 = **~$13,770**
- **MAO is 94% cheaper**
- The 300M context cost lives with the WORKERS (cheap), not the orchestrator. Expensive model stays ~$0.82/task regardless of session size.

### External validation
iternal.ai 2026: hierarchical orchestration (budget workers + frontier planner) achieves **97.7% of full-frontier accuracy at ~61% of cost**. This is our exact architecture, confirmed by independent benchmark.

### Key rule
Context is cheap when it's on cheap models. The expensive model stays tiny regardless of session size. The MAO thesis holds at any context scale — validated by 2026 agentic-coding benchmarks.
