# DevAgent MAO — Researched Idea (Technical + Business + Relationship)

> A multi-agent orchestrator (MAO) for coding. Cheap model converses, expensive model plans only when real work appears, cheap models build in isolated sandboxes, OKF memory learns from every run. Shipped as terminal TUI + desktop app from one engine. Monetized via Playwire sponsorships + credit-capped subscriptions.

This document is the full researched picture: the technical architecture, the business model, and how each technical decision maps to a business outcome.

---

## 1. THE CORE INSIGHT

Coding agents burn money on the wrong thing. A single frontier model (Claude Fable 5, $10/$50 per 1M tokens) both *thinks* and *writes*. But writing code is token-heavy and thinking is token-light. The economic move is to separate them:

- **Talk is cheap.** A tiny model (DeepSeek V4 Flash, $0.14/$0.28) handles the conversation.
- **Think is rare.** An expensive model (Kimi K3, $3/$15; or Fable 5, $10/$50) wakes ONLY when real work appears — to plan, split, and review.
- **Build is cheap.** Cheap models in parallel sandboxes do the actual file edits.

Benchmark validation (iternal.ai 2026): hierarchical orchestration — budget workers + frontier planner — achieves **97.7% of full-frontier accuracy at ~61% of cost.** This is our exact architecture, independently confirmed.

Per-task cost (benchmark-validated, OpenCode ~133K / Claude Code ~298K tokens/task, 3:1 input:output, 1.7× overhead):
- **MAO:** Kimi K3 orchestrator $0.82 + 3× V4 Pro workers $0.55 = **~$1.38/task**
- **Single Fable 5:** **~$22.95/task**
- **94% cheaper**, at near-identical quality.

The MAO isn't a different kind of agent. It's a conversational coding agent (like Claude Code) whose *engine* is orchestrated so the expensive part (thinking) is isolated from the expensive-looking part (writing).

---

## 2. TECHNICAL ARCHITECTURE

### 2.1 The Model Stack (three roles, three price points)

| Role | Model | Rate | Why |
|------|-------|------|-----|
| **Conversation face** | DeepSeek V4 Flash | $0.14/$0.28 per 1M | Talks to user, explains, brainstorms. Cheapest capable model. |
| **Orchestrator** | Kimi K3 (default) / Fable 5 (max-intel) | $3/$15 · $10/$50 per 1M | Plans, splits, validates, reviews. Intelligence #4 and #1 on Artificial Analysis. |
| **Workers** | V4 Pro (paid) / V4 Flash (free) | $0.435/$0.87 · $0.14/$0.28 per 1M | Build in sandboxes. Coding-optimized. |

**Why Kimi K3 as default orchestrator:** 57/187 on the intelligence index vs Fable 5's 60/187 — 95% of the smarts at 1/3.4 the cost. Fable 5 is the premium opt-in for users who want max planning quality.

### 2.2 Two Conversation Modes

**Cheap mode (default, all tiers).** V4 Flash converses. Orchestrator wakes ONLY on build tasks. No mid-conversation validation. Bad architectural calls are caught at plan time when the orchestrator reads the full conversation before splitting.

**Guided mode (opt-in, paid tiers).** Orchestrator validates decisions as you talk — the "senior engineer glances over" pattern. Smarter, but adds ~$1.60/session in orchestrator listening cost. User toggles it on when the task matters.

**Why two modes:** this solves the "cheap model cements bad ideas" problem without forcing the expensive model into every chat turn. Most conversations don't need a senior engineer — they need a fast colleague. The expensive model is the planner, not the talker.

### 2.3 The Build Loop

1. You describe the task. V4 Flash converses, scopes it.
2. Real work appears → orchestrator (Kimi K3) wakes, reads conversation, plans the feature split.
3. For each feature: orchestrator scopes the exact files the worker needs (no full-repo duplication), spawns a local sandbox, assigns V4 Pro.
4. Worker (running jcode fork, headless) does the edit. Quality gate (lint + typecheck + tests) runs in-sandbox BEFORE the orchestrator judges — syntax failures are fixed in-place, not retried.
5. Orchestrator judges success. On logic failure (wrong approach, not syntax): writes an OKF doc, re-spins a FRESH sandbox with the lesson pre-loaded (max 3 re-spins, then escalates to human or re-plans).
6. Final merge sandbox stitches outputs. Orchestrator does last review.
7. Conversation resumes on V4 Flash.

Concurrency is user-configured (no auto-decision). Each sandbox gets only the files it needs. Kill-on-done; all temp files deleted except the needed output.

### 2.4 OKF Memory (the learning layer)

- **OKF writes = orchestrator.** Canonical truth, written on success AND failure. What worked, what definitively didn't.
- **OKF reads = workers (two-step retrieval).** Worker embeds its task, queries cognee graph → gets candidate OKF docs → OPENS the relevant ones and judges if they apply. cognee is the index; OKF markdown is the source; the worker is the relevance judge.
- On retry, the failed attempt's OKF doc is pre-loaded so the worker doesn't repeat the mistake.

This attacks the field's #1 cost problem (the OmO creator spent $24K on tokens mostly on re-attempts) by making each failure a reusable lesson.

### 2.5 The Engine: jcode fork (swarm stripped)

jcode (Rust, MIT, 8.7K stars) is the agent runtime inside each sandbox. We fork it and remove `jcode-swarm-core` (its built-in multi-agent feature) — our orchestrator replaces it. We keep: file edits, shell, git, provider routing, memory, TUI.

**Why jcode over OpenCode (hard numbers):**
- RAM: 27.8 MB/session vs OpenCode's 371.5 MB (**13.4× less**). At 10 sessions: 117 MB vs 3.2 GB (**27.7× less**). Our MAO spawns 5+ instances per task — OpenCode would OOM a laptop.
- Startup: 14 ms to first frame vs 1,036 ms (**74× faster**). Matches the "ping" sandbox-spawn claim.
- Built-in semantic vector memory graph (passive + active) — adapts to emit OKF docs.
- Self-dev mode (edit own source, rebuild, reload) — fast fork iteration.

### 2.6 The Sandbox (security-critical)

Your friend's local sandbox system (claims ~ping deploy, not Docker). **Hard requirement: it must be a microVM, not a container.** Research (htdocs.dev 2026): containers are not a security boundary — 8 container-escape CVEs in 18 months, and Claude Code was shown to disable its own sandbox when it blocked task completion. Untrusted mini-models running shell commands need microVM isolation (Firecracker / Cloud Hypervisor / libkrun, e.g. microsandbox — open source, ~125ms boot, hardware-enforced).

Open questions for your friend: interface (REST/CLI/SDK), input contract (files vs mount), output extraction path, real concurrency cap, failure-mode signaling, and crucially — container or microVM.

**De-risking move:** build the orchestrator against a MOCK sandbox interface we define now, so Layer 1 is not blocked on his answers. Swap in his real system when confirmed.

### 2.7 Two Surfaces, One Engine

Same three-panel layout (files · chat · orchestration) rendered two ways:
- **Terminal TUI** — monospace, box chars, runs `devagent-mao` in any terminal
- **Desktop app** — same layout, CSS + buttons, runs as a window (Electron/Tauri)

Identical functionality, one codebase, one orchestrator backend. No feature divergence.

---

## 3. BUSINESS ARCHITECTURE

### 3.1 Pricing (credit-capped, no overage)

| Tier | Price | API credit | Orchestrator | Workers | Ad split | Conversation |
|------|-------|-----------|--------------|---------|----------|--------------|
| Free | $0 | $10 V4 Flash | V4 Flash | V4 Flash | none | cheap mode |
| Starter | $5/mo | $5 | Kimi K3 | V4 Flash | 15% | cheap + guided toggle |
| Pro | $20/mo | $20 | Kimi K3 | V4 Pro | 30% | cheap + guided toggle |
| Max | $50/mo | $50 | Fable 5 opt-in | V4 Pro | 50% | cheap + guided toggle |

**Credit-capped:** max loss per user = subscription price. Exhausted → auto-downgrade to V4 Flash. No surprise bills.

**Key fix (your question):** the free tier DOES use the MAO, but with **V4 Flash as the orchestrator too** — not Kimi K3. A cheap model plans (5K tokens × $0.28/M ≈ $0.0014/build), keeping our free-tier cost at ~$10.04/user/month (the $10 credit we front + pennies of planning). Paid tiers upgrade the orchestrator to Kimi K3/Fable 5. Free users get the full MAO architecture (parallel workers, OKF) planned by a budget model.

### 3.2 The Ad Model (legal path, not AdSense)

**Hard constraint:** AdSense and Carbon Ads are banned in desktop apps (AdSense policy: ads "may not be integrated into a software application of any kind"). Mobile AdMob doesn't apply to Electron desktop.

**The legal network: Playwire.** It explicitly supports desktop-app advertising (dedicated desktop SDK, serves display/video/native). Fallback chain: Playwire → Google Ad Manager (confirmed legal for desktop) → direct sponsor deals → affiliate links.

**The ad slot:** during AI thinking time, a real HTML sponsor banner renders in the response area. Real ad, labeled "Sponsored" (FTC), anti-fraud (max N ads/hour, triggers only on active request + heartbeat).

**The trade:** every paid tier gets Free's $10 V4 Flash credit **unless** they opt out of ads. Opting out removes the free credit. Ads on by default; the free credit is the price of ad-viewing.

### 3.3 Revenue Share & Legal

- **Ad split by tier** (15/30/50%) — but at modeled CPM ($2), no user ever reaches $600/yr. So earnings stay as account credit (no 1099, no cash payout). The $600 threshold is theoretical; realistically it's a subscription rebate, not income.
- **BYOK:** users bringing keys need TWO — orchestrator key + worker key (or one aggregator like OpenRouter). Hosted plans need none.
- **Disclosure:** all sponsored content labeled. Privacy policy + ToS required. GDPR consent for EU.

### 3.4 Unit Economics (1,000 users, $2 CPM, 30% desktop, benchmark-validated costs)

| Tier | Users | Sub $ | Our API cost | Ad rev | Split | Net |
|------|-------|-------|-------------|--------|-------|-----|
| Free | 800 | $0 | -$8,032 ($10.04×800) | +$360 | $0 | -$7,672 |
| Starter | 100 | $500 | -$500 | +$360 | -$54 | +$306 |
| Pro | 70 | $1,400 | -$546 | +$378 | -$113 | +$1,119 |
| Max | 30 | $1,500 | -$234 | +$162 | -$81 | +$1,347 |

**Critical correction:** free users cost us $10.04 each (not the $0.13 earlier). 800 free users = **-$7,672/month**. The paid tiers (+$2,772) don't cover it. The free tier is a loss leader, NOT a profit center.

**What closes the gap:**
1. **Ads must cover free-tier cost.** 800 free users × $10.04 = $8,032/mo. To break even on free tier alone, ads need $8,032/mo = 4M impressions/mo at $2 CPM = 800 users × 167 impressions/day each. Free users at 25 req/day × 1 ad/req = 25 ads/day = ~$1.50/mo/user. **Not enough.** Free tier is a net cost.
2. **Free tier exists to convert.** It's a demo. The business runs on Starter/Pro/Max. Free cost ($7,672) is customer-acquisition spend. If 5% of free converts to paid, CAC is ~$19/converting user — acceptable if LTV > $19 (a $5 Starter user paying 12 months = $60 LTV). Tight but workable.
3. **BYOK free tier.** If free users bring their own keys, our cost drops to ~$0 (they pay their own tokens). The $10 credit is optional. This makes free tier nearly free for us.

**Honest verdict:** the business does NOT break even at 1,000 users on subscriptions + $2 CPM ads alone. It needs either (a) higher CPM ($5-15 dev audience), (b) BYOK free tier to cut the $8K bleed, or (c) 5,000+ users where paid conversion scales. This is a volume game, and the free tier must be mostly BYOK to not sink us.

### 3.5 Zero-Funding Build Sequence

1. **Phase 1 ($0):** Fork jcode, add sponsor banner to desktop shell, BYOK only. Ship free on GitHub. No backend, no API keys to manage.
2. **Phase 2 (ad revenue funds infra):** Playwire live → first sponsor deal → $15 Command Code Provider + $30/mo server.
3. **Phase 3:** Free tier goes live (BYOK + optional $10 credit), cheap mode only.
4. **Phase 4:** Stripe subscriptions, credit system, guided mode, ad splits.

---

## 4. THE RELATIONSHIP (technical decision → business outcome)

| Technical decision | Business consequence |
|--------------------|---------------------|
| **V4 Flash = conversation face** | Conversation costs pennies → free tier viable, casual chat doesn't drain credits |
| **Kimi K3 = orchestrator** | 3.4× cheaper than Fable 5 → our per-build cost is $0.82 not $2.62 → $100 lasts 72 tasks not 23 |
| **V4 Flash orchestrator on FREE tier** | Free-tier cost drops from $30.50 to $10.04/user → the loss-leader doesn't sink us |
| **Workers = V4 Pro (paid) / V4 Flash (free)** | Paid users get better code, free users get enough → clear tier differentiation |
| **Credit-capped subscriptions** | Max loss per user = sub price → no overage risk, no surprise bills, predictable unit economics |
| **OKF save-states** | Fewer re-attempts → lower worker token cost → attacks the #1 cost driver in the field ($24K OmO burn) |
| **Quality gate in-sandbox** | Syntax fixed before orchestrator judgment → fewer expensive orchestrator reviews → cheaper builds |
| **jcode over OpenCode (13× less RAM)** | 5+ parallel sandboxes don't OOM → concurrency feature works → "parallel build" is a selling point |
| **MicroVM sandbox (not container)** | Untrusted mini-model shell commands are safe → we can run BYOK arbitrary code → liability + trust |
| **Playwire not AdSense** | Legal ad serving in desktop app → the ad-revenue model is actually possible |
| **Ad opt-out loses free credit** | Ads are the price of free credit → ad inventory is guaranteed on paid tiers → CPM revenue is stable |
| **Two surfaces, one engine** | Desktop app (ads work) + terminal (lean) → wider reach, same codebase, no double build |
| **Two conversation modes** | Cheap default keeps cost low → guided mode is a paid upsell → free tier is lean, paid is smart |
| **BYOK option** | Power users pay their own tokens → our cost on those users → ~$0 → free tier nearly free |
| **Mock-sandbox-first build** | Layer 1 not blocked on friend's answers → we ship without waiting → zero-funding launch is possible |

---

## 5. THE RISKS (where it breaks)

| Severity | Risk | Mitigation |
|----------|------|-----------|
| 🔴 | Sandbox is a container (not microVM) → host compromise | Verify with friend; wrap in microsandbox if needed |
| 🔴 | Playwire rejects the app / low CPM | Direct sponsor deals + affiliates as floor |
| 🔴 | Free-tier bleed ($8K/mo at 800 users) | Make free tier BYOK-primary; $10 credit optional |
| 🟠 | Kimi K3 / V4 Pro price increases | Model-agnostic router → auto-switch to cheapest equivalent |
| 🟠 | Command Code Provider terms change | OpenRouter fallback (same V4 Pro/Flash rates) |
| 🟠 | OKF lessons are low-quality early on | Quality gate + 3-strike escalation to human |
| 🟡 | Ad fraud (app left open) | Session rate limiting + heartbeat |
| 🟡 | Account sharing | 2 concurrent sessions max |
| 🟡 | 1099 threshold | Account credit below $600 (never reached at modeled CPM) |

---

## 6. THE ONE-PARAGRAPH ANSWER

DevAgent MAO is a conversational coding agent whose engine separates *thinking* from *writing*: a cheap model talks to you, an expensive model plans only when real work appears, and cheap models build in parallel sandboxes that learn from every run. Technically it's a jcode fork with a custom orchestrator + OKF memory + microVM sandboxes. Commercially it's credit-capped subscriptions plus legal desktop sponsorships (Playwire), with a BYOK-first free tier that demos the MAO without bleeding us dry. The relationship: every technical choice (cheap conversation face, cheap free-tier orchestrator, credit caps, OKF lessons, microVM isolation) exists to make the expensive part of coding cheap — so we can sell "the same AI coding you know, at 6% of the cost" and survive the free tier that gets people in the door.
