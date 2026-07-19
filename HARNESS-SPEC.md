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
| Kimi K3 | Orchestrator | ~$3/M | ~$9/M |
| DeepSeek V4 Flash | Worker | $0.14/M | $0.28/M |
| DeepSeek V4 Pro | Worker | $0.435/M | $0.87/M |

Example: task needing ~200K output tokens.
- Single frontier model: ~$0.40
- Split (orchestrator ~10K out + 50K in = $0.24, workers ~190K out at V4 Flash = $0.053): **~$0.29** — 27% cheaper. Gap widens on larger tasks because orchestrator input stays flat (one plan) while workers do token-heavy generation at 3-6x lower rates.

Benchmark validation (htdocs.dev, Apr 2026): multi-agent orchestration with frontier orchestrator + cheap workers is the dominant 2026 pattern (OmO/Sisyphus runs Kimi K2.5 orchestrator + cheaper workers in production). OKF save-states attack the field's #1 cost warning (OmO creator spent $24K on tokens) by reducing re-attempts.

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
