# DevAgent MAO — Researched Idea (Technical + Business + Relationship)

> A multi-agent orchestrator (MAO) for coding. Cheap model converses, expensive model plans only when real work appears, cheap models build in isolated sandboxes, OKF memory learns from every run. Shipped as terminal TUI + desktop app from one engine. **Open-source-first (MIT): the engine is free on GitHub, the hosted tier is the business.**

This is the full researched picture, with honest numbers. **The headline finding: the ad-revenue-share model does not work, and a packaged-model product with no audience cannot self-distribute. The fix is open source — the OpenCode playbook — with the hosted tier as the only monetization.**

---

## 0. WHAT CHANGED AFTER REAL RESEARCH

Three earlier assumptions were wrong when checked against live data (July 2026):

1. **V4 Flash is $0.09/$0.18 per 1M (OpenRouter), not $0.14/$0.28.** Verified via OpenRouter + pricepertoken. Cheaper, but not enough to save the old model.
2. **Ad CPM is the load-bearing unknown.** Developer networks (Carbon/BuySellAds/Playwire) command ~$8-20 CPM for proven technical audiences, but a new unproven desktop slot starts far lower. The old ad-split payout ($1,605/mo) was 6x the ad revenue ($270/mo at $2 CPM) — we were paying out of subscriptions, not ads.
3. **The free tier bleeds if we front API cost.** A build-heavy free user on a $10 credit costs up to $20.86/mo. 800 such users = -$8,000+/mo.
4. **No audience = no distribution.** A packaged-model product competes with Command Code (7.5M devs, real provider deals) and Cursor. Without a brand or marketing budget, it cannot self-sell. Open source is the only free, compounding channel.

---

## 1. THE CORE INSIGHT (validated)

Coding agents waste money making one expensive model do two jobs: *think* (cheap, token-light) and *write* (expensive, token-heavy). Separate them:

- **Talk is cheap.** DeepSeek V4 Flash ($0.09/$0.18) converses.
- **Think is rare.** Kimi K3 ($3/$15, intelligence 57/187) wakes only to plan, split, review.
- **Build is cheap.** DeepSeek V4 Pro ($0.435/$0.87, intelligence 44/187) writes in parallel sandboxes.

Benchmark validation (iternal.ai 2026): hierarchical orchestration = **97.7% of full-frontier accuracy at ~61% of cost.**

Per-build cost (benchmark-validated: OpenCode ~133K / Claude Code ~298K tokens/task, 3:1 input:output, 1.7x retry overhead):
- **MAO:** Kimi K3 orchestrator $0.82 + 3x V4 Pro workers $0.55 = **$1.38/build** (V4 Flash workers = $0.94/build)
- **Single Fable 5 ($10/$50, intelligence 60/187):** **$22.95/build**
- **94% cheaper**, near-identical quality.

**Competitive positioning (real numbers):** a user doing 14 builds/mo on Claude Fable 5 directly pays ~$321. We sell the same work for a $20 Pro plan. Our cost is ~$19. The user saves $301; we keep ~$1. **Volume business** — thin per-user margin, made up in scale.

---

## 2. TECHNICAL ARCHITECTURE

### 2.1 Three-model stack (verified rates, July 2026)

| Role | Model | Rate (per 1M) | Intelligence | Why |
|------|-------|---------------|--------------|-----|
| Conversation face | DeepSeek V4 Flash | $0.09 in / $0.18 out | — | Cheapest capable talker. 284B MoE, 13B active, 1M ctx, MIT. |
| Orchestrator | Kimi K3 (default) | $3 / $15 | 57/187 | 95% of Fable 5's smarts at 1/3.4 cost. |
| Orchestrator (max-intel) | Claude Fable 5 | $10 / $50 | 60/187 | Premium opt-in. |
| Workers (paid) | DeepSeek V4 Pro | $0.435 / $0.87 | 44/187 | Coding-optimized. |
| Workers (free) | DeepSeek V4 Flash | $0.09 / $0.18 | — | Good enough for free builds. |

Note: there are $0.00-$0.02/M models (Devstral 2, Gemma 3n) but they rank far below coding quality — not usable as the conversation face. V4 Flash is the floor that still codes.

### 2.2 Two conversation modes
- **Cheap mode (default, all tiers):** V4 Flash converses; orchestrator wakes only on builds. Bad calls caught at plan time.
- **Guided mode (opt-in, paid):** orchestrator validates mid-conversation ("senior engineer glances over"). Adds ~$1.60/session. A **paid upsell**, not a default.

### 2.3 The build loop
Plan (Kimi K3) → scope files per feature → spawn local sandbox → worker (jcode fork, headless) edits → in-sandbox quality gate (lint/typecheck/tests) → orchestrator judges → on logic failure, write OKF doc + re-spin fresh sandbox with lesson (max 3, then escalate) → merge sandbox stitches → orchestrator final review → resume chat. Concurrency user-configured; kill-on-done; temp files deleted except needed output.

### 2.4 OKF memory
Orchestrator writes canonical OKF docs (success AND failure). Workers read via cognee two-step retrieval (embed task → query graph → open + judge relevant docs). Retry pre-loads the lesson. Attacks the field's #1 cost driver (re-attempts — the OmO creator's $24K burn).

### 2.5 Engine: jcode fork (swarm removed)
Rust, MIT. Remove `jcode-swarm-core`, keep agent runtime. **Why jcode over OpenCode:** 13.4x less RAM/session (27.8 MB vs 371.5 MB), 74x faster startup (14 ms vs 1,036 ms) — critical because the MAO spawns 5+ instances per build. OpenCode would OOM a laptop.

### 2.6 Sandbox (security hard-requirement)
Friend's local system (~ping deploy, not Docker). **Must be a microVM, not a container.** Containers are not a security boundary (8 escape CVEs in 18 months; Claude Code disables its own sandbox). Untrusted mini-model shell commands need Firecracker/Cloud Hypervisor/libkrun isolation (e.g. microsandbox, ~125 ms boot). Open: interface, output extraction, real concurrency cap, failure signaling, container-vs-microVM. **Build against a mock interface first** so Layer 1 isn't blocked.

### 2.7 Two surfaces, one engine
Same three-panel layout (files · chat · orchestration) rendered as terminal TUI and desktop app. Identical functionality, one codebase.

---

## 3. BUSINESS ARCHITECTURE (open-source-first, packaged model, no ads)

### 3.1 The distribution problem (the real blocker)
No brand, no audience, no marketing budget. Competing with Command Code (7.5M devs, real provider deals) or Cursor on "97% of frontier at 6% of cost" requires people to *hear* the claim. Paid acquisition needs $50-200/user CAC; thin margins can't fund it. The only free, compounding channel is **open source** — the OpenCode playbook (MIT, GitHub stars, hosted service as the business).

### 3.2 Packaged model, not token reseller
Sell the *outcome*, not the compute. Name the model, name what's inside. "$10 for 97% of frontier task completion — it's Kimi K3 + DeepSeek V4 Flash." Transparency is the pitch. Real compute cost (benchmark-validated, July 2026):
- Kimi K3 + V4 Flash workers: **$0.94/build**
- Kimi K3 + V4 Pro workers: **$1.38/build**
- Fable 5 alone (frontier): **$22.95/build**

A $10 hosted plan = ~10 orchestrated builds that cost $229 on Fable 5 directly. That's the claim that compounds on GitHub — developers verify it.

### 3.3 Pricing (open-source-first)
| Tier | Price | What you pay for | Compute cost to us | Margin |
|------|-------|------------------|---------------------|--------|
| **Self-hosted** | $0 | MIT engine, you run it | $0 (BYOK) | n/a |
| **Hosted · Flash** | $10/mo | we run K3+V4Flash ~10 builds | $9.40 | $0.60 (6%) |
| **Hosted · Pro** | $20/mo | we run K3+V4Pro ~14 builds | $19.31 | $0.69 (3%) |
| **Hosted · Max** | $50/mo | Fable opt-in ~36 builds | ~$49.70 | ~$0.30 (1%) |

**Margin is razor-thin (1-6%).** Fine IF open source drives free distribution and the hosted tier is the conversion. We don't make money on the compute arbitrage — we make it on volume + the convenience of not-self-hosting.

### 3.4 No ads. Why.
The ad-revenue-share model was unfundable: modeled payout ($1,605/mo) was 6x ad revenue ($270/mo at $2 CPM). Ads also need an audience we don't have. If ads ever come, they subsidize compute — never the business. The product sells on cost + quality, not ad subsidies.

### 3.5 Unit economics (honest, hosted-tier only)
At 1,000 self-hosted users + 200 paid (20% conversion, generous for 2-5% freemium norm):
- Revenue: (100x$10) + (70x$20) + (30x$50) = $1,000 + $1,400 + $1,500 = **$3,900**
- Compute cost: $940 + $1,351 + $1,491 = **$3,782**
- Infra (server, auth, build): **$100**
- **Net: +$18/month** at 1,000 + 200. Barely break-even.
- At 5,000 + 1,000 paid: revenue $19,500, compute $18,910, infra $300 → **+$290/mo.**
- At 10,000 + 2,000 paid: **+$1,180/mo.**

**Verdict:** volume business. Real money needs 5,000+ users. The open-source repo is the funnel; the hosted tier is the conversion. Thin per-user margin, made up in scale.

### 3.6 Build sequence (zero funding)
1. **Phase 1 ($0):** jcode fork + orchestrator + OKF memory + mock sandbox. MIT, ship on GitHub. BYOK only. No backend.
2. **Phase 2:** Stripe for the hosted tier. Run orchestrator server-side. Self-host stays free.
3. **Phase 3:** Guided mode, team plans, Fable opt-in.
4. **Phase 4 (only if audience exists):** optional sponsor slot, subsidizing compute — never the business.

---

## 4. RELATIONSHIP (technical decision -> business outcome)

| Technical decision | Business consequence |
|--------------------|---------------------|
| V4 Flash conversation face | Chat costs pennies -> self-hosted tier viable, casual use doesn't drain credits |
| Kimi K3 orchestrator ($3/$15 not $10/$50) | Per-build $0.82 not $2.62 -> $100 lasts 72 builds -> thin margin per build survives |
| V4 Flash orchestrator on FREE tier | Free cost ~$0.14/build -> but free is BYOK anyway, so cost $0 |
| V4 Pro paid workers | 44/187 intelligence, coding-optimized -> paid users get real quality, clear tier gap |
| OKF save-states | Fewer re-attempts -> lower worker tokens -> attacks the field's #1 cost driver |
| Quality gate in-sandbox | Syntax fixed before orchestrator review -> fewer expensive orchestrator calls |
| jcode (13x less RAM) | 5+ parallel sandboxes don't OOM -> "parallel build" feature works -> a real selling point |
| MicroVM sandbox | Untrusted BYOK code runs safely -> enables the self-hosted free tier |
| MIT open source | Free distribution (OpenCode playbook) -> no brand needed -> the funnel, not the product |
| Packaged model framing | "97% frontier at 6% cost, here's the recipe" -> trust via transparency, not ads |
| Hosted tier = the business | Thin 1-6% margin on compute -> works only at volume -> open source drives the users |
| No ad-revenue split | Removes the $1,605-vs-$270 payout death spiral -> subscriptions/compute is the revenue |
| BYOK free + hosted paid | Free users cost $0 -> self-host is the funnel -> hosted tier converts -> no bleed |
| Two conversation modes | Cheap default keeps cost low -> guided mode is a paid upsell |
| Mock-sandbox-first build | Layer 1 not blocked -> zero-funding launch possible |

---

## 5. RISKS (where it breaks)

| Severity | Risk | Mitigation |
|----------|------|-----------|
| RED | Orchestration doesn't reliably merge | Validate with a 10-min experiment before building: can K3 split a task into 2 features, V4 Flash build both, merge clean? If no, thesis collapses. |
| RED | No audience for open source either | 90+ open agents exist. Need a clear "why this one" — orchestrated parallel builds + OKF memory must be felt in first 10 min. |
| RED | Sandbox is a container not a microVM | Verify with friend; wrap in microsandbox if needed |
| ORANGE | Kimi K3 / V4 Pro price increases | Model-agnostic router -> auto-switch to cheapest equivalent |
| ORANGE | Command Code Provider terms change | OpenRouter fallback (same V4 rates) |
| ORANGE | OKF lessons low-quality early | Quality gate + 3-strike escalation to human |
| YELLOW | Account sharing | 2 concurrent sessions max |
| YELLOW | Maintenance burden (solo) | Open source = issues/PRs/Discord. Hosted tier must fund the time. |

---

## 6. THE HONEST ONE-PARAGRAPH ANSWER

DevAgent MAO is a conversational coding agent whose engine separates thinking from writing so coding costs ~6% of a frontier model. Technically it's a jcode fork + custom orchestrator + OKF memory + microVM sandboxes, MIT-licensed. Commercially it's **open-source-first**: the engine is free on GitHub (the distribution we can afford without a brand), and the hosted tier is the business — we run the orchestrator for you at thin 1-6% margins on compute, which only works at volume. The packaged-model framing ("97% of frontier, here's exactly what's inside: Kimi K3 + DeepSeek V4 Flash") replaces the broken ad-revenue-share idea, which was unfundable (paying users $1,605/mo from $270/mo in ads). The decision that makes the balance sheet work is **BYOK free tier**: self-hosted users cost us $0, the open repo is a pure funnel, and the hosted tier converts at scale. At 1,000 users + 200 paid it breaks even; real profit needs 5,000+ users. Every technical choice exists to make orchestrated coding genuinely cheaper so the GitHub repo earns stars and the hosted plan earns the arbitrage.
