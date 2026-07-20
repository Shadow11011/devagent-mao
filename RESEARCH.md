# DevAgent MAO — Researched Idea (Technical + Business + Relationship)

> A multi-agent orchestrator (MAO) for coding. Cheap model converses, expensive model plans only when real work appears, cheap models build in isolated sandboxes, OKF memory learns from every run. Shipped as terminal TUI + desktop app from one engine. Monetized via credit-capped subscriptions, with sponsorships as a secondary (not primary) revenue stream.

This is the full researched picture, with honest numbers. **The headline finding: the ad-revenue-share model as originally scoped does not work. Subscriptions are the engine; sponsorships are supplementary. The free tier must be BYOK-first or it sinks the business.**

---

## 0. WHAT CHANGED AFTER REAL RESEARCH

Three assumptions from earlier sessions were wrong when checked against live data:

1. **V4 Flash is $0.09/$0.18 per 1M (OpenRouter), not $0.14/$0.28.** Verified July 2026 via OpenRouter + pricepertoken. The cheaper rate helps, but not enough to save the old model.
2. **Ad CPM is the load-bearing unknown, and $2 is not conservative — it's optimistic for an unproven inventory.** Developer-focused networks (Carbon/BuySellAds/Playwire) command ~$8-20 CPM for proven technical audiences, but a new desktop-app ad slot with no track record starts far lower. Worse, the ad-split payout we modeled ($1,605/mo) was 6× the ad revenue ($270/mo at $2 CPM) — we were paying out of subscriptions, not ads.
3. **The free tier bleeds if we front the API cost.** A build-heavy free user on a $10 credit costs us up to $20.86/mo (V4 Flash conversation + V4 Flash orchestrated builds at 25 req/day, 20% builds). 800 such users = -$8,000+/mo.

The fix is structural, not cosmetic. Details below.

---

## 1. THE CORE INSIGHT (unchanged, and validated)

Coding agents waste money making one expensive model do two jobs: *think* (cheap, token-light) and *write* (expensive, token-heavy). Separate them:

- **Talk is cheap.** DeepSeek V4 Flash ($0.09/$0.18) converses.
- **Think is rare.** Kimi K3 ($3/$15, intelligence 57/187) wakes only to plan, split, review.
- **Build is cheap.** DeepSeek V4 Pro ($0.435/$0.87, intelligence 44/187) writes in parallel sandboxes.

Benchmark validation (iternal.ai 2026): hierarchical orchestration = **97.7% of full-frontier accuracy at ~61% of cost.**

Per-build cost (benchmark-validated: OpenCode ~133K / Claude Code ~298K tokens/task, 3:1 input:output, 1.7× retry overhead):
- **MAO:** Kimi K3 orchestrator $0.82 + 3× V4 Pro workers $0.55 = **$1.38/build**
- **Single Fable 5 ($10/$50, intelligence 60/187):** **$22.95/build**
- **94% cheaper**, near-identical quality.

**Competitive positioning (real numbers):** a user doing 14 builds/mo on Claude Fable 5 directly pays ~$321. We sell the same work for a $20 Pro plan. Our cost is ~$19. The user saves $301; we keep ~$1. **This is a volume business** — thin per-user margin, made up in scale and in upsells (BYOK, guided mode, team plans).

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

Note: there are $0.00–$0.02/M models (Devstral 2, Gemma 3n E4B) but they rank far below coding quality — not usable as the conversation face. V4 Flash is the floor that still codes.

### 2.2 Two conversation modes
- **Cheap mode (default, all tiers):** V4 Flash converses; orchestrator wakes only on builds. Bad calls caught at plan time.
- **Guided mode (opt-in, paid):** orchestrator validates mid-conversation ("senior engineer glances over"). Adds ~$1.60/session. This is a **paid upsell**, not a default.

### 2.3 The build loop
Plan (Kimi K3) → scope files per feature → spawn local sandbox → worker (jcode fork, headless) edits → in-sandbox quality gate (lint/typecheck/tests) → orchestrator judges → on logic failure, write OKF doc + re-spin fresh sandbox with lesson (max 3, then escalate) → merge sandbox stitches → orchestrator final review → resume chat. Concurrency user-configured; kill-on-done; temp files deleted except needed output.

### 2.4 OKF memory
Orchestrator writes canonical OKF docs (success AND failure). Workers read via cognee two-step retrieval (embed task → query graph → open + judge relevant docs). Retry pre-loads the lesson. This attacks the field's #1 cost driver (re-attempts — the OmO creator's $24K burn).

### 2.5 Engine: jcode fork (swarm removed)
Rust, MIT. Remove `jcode-swarm-core`, keep agent runtime. **Why jcode over OpenCode:** 13.4× less RAM/session (27.8 MB vs 371.5 MB), 74× faster startup (14 ms vs 1,036 ms) — critical because the MAO spawns 5+ instances per build. OpenCode would OOM a laptop.

### 2.6 Sandbox (security hard-requirement)
Friend's local system (~ping deploy, not Docker). **Must be a microVM, not a container.** Containers are not a security boundary (8 escape CVEs in 18 months; Claude Code disables its own sandbox). Untrusted mini-model shell commands need Firecracker/Cloud Hypervisor/libkrun isolation (e.g. microsandbox, ~125 ms boot). Open: interface, output extraction, real concurrency cap, failure signaling, and container-vs-microVM. **Build against a mock interface first** so Layer 1 isn't blocked.

### 2.7 Two surfaces, one engine
Same three-panel layout (files · chat · orchestration) rendered as terminal TUI and desktop app. Identical functionality, one codebase.

---

## 3. BUSINESS ARCHITECTURE (restructured to balance)

### 3.1 Pricing (credit-capped; free tier is BYOK)

| Tier | Price | API credit | Orchestrator | Workers | Conversation | Notes |
|------|-------|-----------|--------------|---------|--------------|-------|
| **Free** | $0 | **BYOK** (bring your own V4 Flash key) | V4 Flash | V4 Flash | cheap mode | Cost to us ≈ $0 |
| **Starter** | $5/mo | $5 + $10 V4 Flash welcome credit | Kimi K3 | V4 Flash | cheap + guided toggle | welcome credit = ad-viewing price |
| **Pro** | $20/mo | $20 | Kimi K3 | V4 Pro | cheap + guided toggle | ~14 builds |
| **Max** | $50/mo | $50 | Fable 5 opt-in | V4 Pro | cheap + guided toggle | ~36 builds |

**The structural fix:** free tier does NOT get a free $10 credit. Free = BYOK (user brings their own V4 Flash key, our cost $0). The $10 welcome credit is a **paid-tier perk** you get for watching ads. This removes the -$8,000/mo free bleed entirely.

**Credit-capped:** max loss per user = subscription price. Exhausted → throttle to V4 Flash. No surprise bills.

### 3.2 Sponsorships (secondary, not primary)

- **Legal path:** Playwire (desktop-app-supported) → Google Ad Manager → direct sponsor deals → affiliate links. AdSense/Carbon are banned in desktop apps.
- **The ad slot:** real HTML banner during AI thinking, labeled "Sponsored," anti-fraud rate-limited.
- **The trade:** paid tiers get the $10 V4 Flash welcome credit for leaving ads ON. Opting out removes it.
- **NO ad-revenue split.** The earlier 15/30/50% split was unfundable (payout $1,605 vs ad rev $270). Cut it. Instead: **ads subsidize the welcome credit**, and at scale ads are a bonus margin line, not a user payout.

### 3.3 Revenue share — REMOVED, and why
Paying users a % of ad revenue only works when ad revenue > payout. At any realistic CPM for unproven inventory, it isn't. So: no split. The "earn from ads" pitch becomes "watch ads, get $10 of free V4 Flash credit" — a rebate, funded by us, capped, and honest.

### 3.4 Balanced unit economics (1,000 users, honest assumptions)

Assumptions, all labeled:
- 700 free BYOK (cost ~$0), 0 free-credit users (credit moved to paid perk)
- 150 Starter, 100 Pro, 50 Max (30% paid conversion — optimistic; industry freemium is 2-5%, so this assumes strong product pull)
- CPM $8 (dev audience, mid estimate; range $2-15)
- 30% desktop adoption, 15 ad impressions/day/user

**Revenue:**
- Subscriptions: (150×$5) + (100×$20) + (50×$50) = $750 + $2,000 + $2,500 = **$5,250**
- Ads: 1,000 users × 30% × 15/day × 30 days ÷ 1000 × $8 = **$1,080**
- Total revenue: **$6,330**

**Costs:**
- Starter API: 150 × $5 = $750
- Pro API: 100 × $20 = $2,000
- Max API: 50 × $50 = $2,500
- Welcome credits (300 paid users × $10 V4 Flash, but it's pass-through credit): 300 × $10 = $3,000 — *but* this is credit we front that users spend on V4 Flash; at $0.09/$0.18 it's ~30M tokens, realistically only ~40% burns = **$1,200**
- Infrastructure (server, auth, ad serving): **$100**
- Total costs: **$6,150**

**Net: +$180/month at 1,000 users.** Barely break-even, and only because free tier is BYOK (cost $0) and paid conversion is a healthy 30%.

**At $2 CPM:** ads drop to $270, net = **-$630/month.** Slightly underwater.
**At $15 CPM:** ads = $2,025, net = **+$1,125/month.** Comfortable.

### 3.5 The three levers that make it profitable
1. **CPM.** At $8 we break even; at $15 we're profitable. Developer audiences can command this — but only after the inventory proves itself. Year 1, assume $2-4.
2. **BYOK free tier.** Non-negotiable. If free users cost us $10 each, the business dies. BYOK = $0 cost = the free tier is a pure funnel.
3. **Paid conversion.** 30% is what the model needs. Industry freemium is 2-5%. The gap is closed by the MAO's genuine cost advantage (94% cheaper coding is a real reason to pay) and by the welcome-credit nudge. But this is the riskiest assumption.

**Honest verdict:** at 1,000 users this is a break-even-to-slightly-positive business IF free is BYOK and CPM is decent. Real profit needs 5,000+ users (where subscriptions scale) or a $15 CPM. This is a 12-18 month volume game, not a launch-month money printer.

### 3.6 Zero-funding build sequence
1. **Phase 1 ($0):** jcode fork + sponsor banner in desktop shell, BYOK only. Ship free on GitHub. No backend.
2. **Phase 2 (ad revenue funds infra):** Playwire live → first sponsor deal → $30/mo server + BYOK free tier.
3. **Phase 3:** Stripe subscriptions + credit system + cheap mode.
4. **Phase 4:** Guided mode, welcome credit, team plans, Fable 5 opt-in.

---

## 4. RELATIONSHIP (technical decision → business outcome)

| Technical decision | Business consequence |
|--------------------|---------------------|
| V4 Flash conversation face | Chat costs pennies → free tier viable, casual use doesn't drain credits |
| Kimi K3 orchestrator ($3/$15 not $10/$50) | Per-build $0.82 not $2.62 → $100 lasts 72 builds → thin margin per build survives |
| V4 Flash orchestrator on FREE tier | Free cost ~$0.14/build → but we removed free credit anyway, so free = BYOK = $0 cost |
| V4 Pro paid workers | 44/187 intelligence, coding-optimized → paid users get real quality, clear tier gap |
| Credit-capped subscriptions | Max loss = sub price → predictable unit economics, no overage |
| OKF save-states | Fewer re-attempts → lower worker tokens → attacks the field's #1 cost driver |
| Quality gate in-sandbox | Syntax fixed before orchestrator review → fewer expensive orchestrator calls |
| jcode (13× less RAM) | 5+ parallel sandboxes don't OOM → "parallel build" feature works → a real selling point |
| MicroVM sandbox | Untrusted BYOK code runs safely → enables the BYOK free tier that makes the model balance |
| Playwire (not AdSense) | Legal desktop ads → the welcome-credit subsidy is fundable |
| No ad-revenue split | Removes the $1,605-vs-$270 payout death spiral → subscriptions fund perks, ads are bonus |
| BYOK free tier | Free users cost $0 → the -$8,000/mo bleed disappears → break-even becomes possible |
| Two conversation modes | Cheap default keeps cost low → guided mode is a paid upsell → free is lean, paid is smart |
| Mock-sandbox-first build | Layer 1 not blocked → zero-funding launch possible |

---

## 5. RISKS (where it breaks)

| Severity | Risk | Mitigation |
|----------|------|-----------|
| 🔴 | CPM is $2-4 not $8-15 (unproven inventory) | Sponsorships are supplementary; subscriptions carry the business |
| 🔴 | Free users won't BYOK (friction) | $10 welcome credit as the hook; but then cap it hard (V4 Flash only, low build count) |
| 🔴 | Paid conversion is 2-5% not 30% | The 94% cost advantage + welcome credit must pull harder; if not, the model needs enterprise/team plans |
| 🔴 | Sandbox is a container not a microVM | Verify with friend; wrap in microsandbox if needed |
| 🟠 | Kimi K3 / V4 Pro price increases | Model-agnostic router → auto-switch to cheapest equivalent |
| 🟠 | Command Code Provider terms change | OpenRouter fallback (same V4 rates) |
| 🟠 | OKF lessons low-quality early | Quality gate + 3-strike escalation to human |
| 🟡 | Ad fraud | Session rate limiting + heartbeat |
| 🟡 | Account sharing | 2 concurrent sessions max |

---

## 6. THE HONEST ONE-PARAGRAPH ANSWER

DevAgent MAO is a conversational coding agent whose engine separates thinking from writing so coding costs 6% of a frontier model. Technically it's a jcode fork + custom orchestrator + OKF memory + microVM sandboxes. Commercially it's credit-capped subscriptions with sponsorships as a secondary stream — NOT an ad-revenue-share product, because the math doesn't support paying users out of ad revenue at realistic CPMs. The single decision that makes the balance sheet work is **BYOK free tier**: free users bring their own keys (cost $0), so the free tier is a pure funnel instead of an $8,000/month bleed. At 1,000 users with 30% paid conversion and $8 CPM, it breaks even. Real profit needs 5,000+ users or proven $15 CPM. Every technical choice — cheap conversation face, cheap free-tier orchestrator, credit caps, OKF lessons, microVM isolation — exists to make the expensive part of coding cheap, so we can sell "frontier-quality coding at 6% of the cost" and survive the free tier that gets people in the door.
