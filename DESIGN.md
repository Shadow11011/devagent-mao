# DevAgent — Design Doc (MAO: Multi-Agent Orchestrator)

> Desktop coding agent with in-app sponsorships. DevAgent MAO: a multi-agent orchestrator (large model orchestrates cheaper models in isolated sandboxes, learns via OKF). Shipped as terminal TUI + desktop app from one codebase. Playwire ads, credit-capped subscriptions.

## 1. Problem & Insight

Coding agents (Claude Code, Command Code, Cursor) show raw model "thinking" text in a status area during waits. That screen space is dead. We replace it with a sponsor banner and pay users a share of the ad revenue. Users get a free/open-source coding agent; paid users earn from their own screen time.

## 2. Product

A native desktop app (Cursor/Claude Code desktop style). The DevAgent MAO engine runs locally, doing file edits, shell, git, MCP invisibly. User never touches a terminal. During AI "thinking" time, a sponsor banner renders in the response area. Real HTML (Chromium/Tauri webview), so any web ad creative works.

Two surfaces removed: no terminal CLI, no OSC 8 text ads. Single desktop app only.

## 3. Architecture

```
DevAgent Desktop (Electron/Tauri)
  ├─ React UI · file tree · editor · chat · sponsor banner
  └─ jcode fork (MIT) — local FS/Shell/Git/MCP agent runtime
        ├─ OpenRouter  → FREE tier (DeepSeek V4 Flash, $0.09/$0.18)
        └─ Command Code Provider → PAID tiers (V4 Pro 4x, MiMo 99%, MiniMax 2.7x)
  └─ Backend (FastAPI) — Auth · Billing · Ads · Payout · Model routing
        ├─ Playwire SDK (primary ad network, desktop-legal)
        ├─ Google Ad Manager (fallback if approved)
        ├─ Stripe (subscriptions)
        └─ Marketing site (Next.js, Vercel, devagent.ai)
```

## 4. Models & Pricing

| Tier | Price | API credit | Models | Ads | Ad split |
|------|-------|-----------|--------|-----|----------|
| Free | $0 | $10/mo V4 Flash | DeepSeek V4 Flash (OpenRouter) | none | none |
| Starter | $5/mo | $5 + everything in Free* | all open-source | on (opt-out available) | 15% |
| Pro | $20/mo | $20 + everything in Free* | V4 Pro + MiniMax | on (opt-out available) | 30% |
| Max | $50/mo | $50 + everything in Free* | all models | on (opt-out available) | 50% |

*Every paid tier includes the Free tier benefits (the $10 V4 Flash credit) UNLESS the user opts out of ads. Opting out of ads removes the $10 V4 Flash credit — paid users keep only their tier's API credit + model access. Max loss per user = subscription price. Exhausted credit → auto-downgrade to V4 Flash or throttle. No overage.

Free tier via OpenRouter eliminates Command Code dependency for free users. Paid tiers use Command Code for deal multipliers (V4 Pro 4x, MiMo 99% off).

## 5. Ad Strategy

**Primary: Playwire** — full-stack ad platform with explicit desktop app support (apply-desktop-app). Programmatic display/video/native. Legal where AdSense is banned (AdSense policy: "ads may not be distributed through software applications including desktop applications").

**Fallback chain (no single point of failure):**
1. Playwire (primary)
2. Google Ad Manager (desktop-legal per GAM support, needs approval)
3. Direct sponsor deals (Vercel, Supabase, Railway — always available)
4. Affiliate links (earn per signup, always available)

**Sponsor disclosure:** all sponsored content labeled "Sponsored" / "Ad" per FTC rules.

**Anti-fraud:** max N ads/hour per session, ad only triggers on active agent request, heartbeat confirms app in use.

## 6. Revenue Share & Legal

- Ad earnings below $600/user/yr = account credit (discounts subscription). No cash payout, no 1099.
- Above $600/yr → cash payout + tax form. At modeled CPM, users never reach this.
- Privacy policy + ToS required (impression tracking). GDPR consent if EU users.
- We are the publisher AND effectively the network (direct deals). Playwire is the programmatic layer.

## 7. Unit Economics (1,000 users, $2 CPM, 30% desktop)

| Tier | Users | Sub $ | API cost | Ad rev | Split | Net |
|------|-------|-------|----------|--------|-------|-----|
| Free | 800 | $0 | -$104 | +$360 | $0 | +$256 |
| Starter | 100 | $500 | -$500 | +$360 | -$54 | +$306 |
| Pro | 70 | $1,400 | -$546 | +$378 | -$113 | +$1,119 |
| Max | 30 | $1,500 | -$234 | +$162 | -$81 | +$1,347 |

**Total: ~$2,800/mo profit.** At $0 CPM → ~$1,500 (paid subs only). At $10 CPM → ~$5,500. CPM is the lever.

## 8. Risks

| Sev | Risk | Mitigation |
|-----|------|-----------|
| 🔴 | Playwire rejects app (too small/narrow) | Direct deals + affiliates always available |
| 🔴 | CPM assumption wrong ($2 → $0) | Free tier still near break-even; affiliates floor revenue |
| 🟠 | Paid API cost > subscription | SOLVED: credit caps |
| 🟠 | Ad fraud (idle app) | Session rate limiting + heartbeat |
| 🟠 | Account sharing | 2 concurrent sessions max, device fingerprint |
| 🟡 | 1099 threshold | Account credit below $600 |
| 🟡 | Electron auto-update | electron-updater + S3/MinIO |
| 🟡 | Legal docs | Privacy policy, ToS, sponsor disclosure |

## 9. Build Sequence (zero funding)

1. **Fork jcode**, add sponsor banner to desktop UI. BYOK only. Ship free.
2. **Playwire integration** + first sponsor deal. $15 Provider plan + $30/mo server.
3. **Free tier live**: OpenRouter, V4 Flash, $10 credit pool.
4. **Stripe subs** + ad revenue splits (account credit).

## 10. Open Items

- [ ] Brand name + domain purchase
- [ ] Playwire application + CPM validation
- [ ] Build owner / timeline
- [ ] Privacy policy, ToS, sponsor disclosure copy
- [ ] Marketing site (Next.js, Vercel)
