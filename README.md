# DevAgent MAO

**A multi-agent orchestrator for coding. A cheap model talks to you, a smart model plans and validates, cheap models build in isolated sandboxes. 94% cheaper than frontier — with the math to prove it.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-spec--stage-yellow.svg)](BUILD.md)

```
you type:        "add auth, a dashboard, and payments"

                 ┌─────────────────────────────────────────┐
                 │  MAO — the brain                        │
                 │  plans · routes · couples · remembers   │
                 │  Kimi K3 (thinking is rare)             │
                 ├─────────────────────────────────────────┤
                 │  Shiro — the hands                      │
                 │  spawns · isolates · snapshots · kills  │
                 │  bwrap / sandbox-exec / WSL2 / fallback │
                 ├─────────────────────────────────────────┤
                 │  jcode fork — the fingers               │
                 │  reads · writes · runs · exits          │
                 │  DeepSeek V4 (writing is cheap)         │
                 └─────────────────────────────────────────┘

                 → working code, merged, verified, ~$1.38
                 → same build on Fable 5 alone: ~$22.95
```

## Why it exists

Every coding agent fires one expensive model at your whole task. You pay premium rates for planning AND boilerplate. MAO splits the jobs:

- **Talk is cheap** — DeepSeek V4 Flash converses ($0.09/$0.18 per 1M)
- **Think is rare** — Kimi K3 plans, validates, reviews ($3/$15, 57/187 intelligence)
- **Write is cheap** — DeepSeek V4 Pro/Flash builds in parallel sandboxes ($0.435/$0.87)
- **Memory compounds** — every build leaves an OKF lesson; the next build starts smarter

Validated externally (iternal.ai 2026): hierarchical orchestration = **97.7% of frontier accuracy at ~61% of cost.**

## Docs (read in this order)

| Doc | What it is |
|-----|-----------|
| [BUILD.md](BUILD.md) | The full architecture: components, build flow, repo layout, build order |
| [VALIDATION.md](VALIDATION.md) | The experiment we run BEFORE writing the orchestrator. Kill criteria included |
| [SANDBOX-INTERFACE.md](SANDBOX-INTERFACE.md) | The formal Shiro API contract (spawn, mount, extract, kill, failure codes) |
| [PROMPTS.md](PROMPTS.md) | The orchestrator prompt specs — the core IP |
| [TESTING.md](TESTING.md) | Test strategy for a parallel multi-agent system |
| [MOAT.md](MOAT.md) | Why this isn't just "route to cheap models" |
| [HARNESS-SPEC.md](HARNESS-SPEC.md) | Original harness design (conversation model, two modes) |
| [RESEARCH.md](RESEARCH.md) | The business model, honest unit economics, risks |
| [DESIGN.md](DESIGN.md) | Historical: the ad-supported desktop-app exploration (superseded) |

## Quick start (when built)

```bash
npm i -g devagent-mao
export OPENROUTER_API_KEY=...   # BYOK: one key covers all models
mao
```

Self-hosted is free forever (MIT). The hosted tier (we run the orchestrator) is the business.

## Cost model (honest, benchmark-validated)

Per build (3 features, 2 waves, real-world token counts: ~133-300K tokens/task, 3:1 input:output, 1.7× retry overhead):

| Component | Model | Cost |
|-----------|-------|------|
| Planning + review | Kimi K3 | ~$0.82 |
| 3 workers × 1.7× | V4 Pro | ~$0.55 |
| **MAO total** | | **~$1.38** |
| Single Fable 5 (same work) | | **~$22.95** |

Flash workers (free tier) drop it to **~$0.94**. Any doc or demo claiming ~$0.04/build is wrong — real agentic tasks burn 100K+ tokens. See [compare page](https://devagent-site.vercel.app/compare.html).

## License

MIT. Fork it, self-host it, never pay us. The hosted tier is for people who'd rather not run it.
