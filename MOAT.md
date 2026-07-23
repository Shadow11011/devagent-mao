# MOAT — why this isn't just "route to cheap models"

> "97% of frontier at 6% of the cost" is a **price** advantage. Anyone can call OpenRouter. Price is not a moat. Every build decision must reinforce the three things that actually are.

## 1. OKF memory compounds (switching cost)
After 100 builds on a user's codebase, the agent knows its patterns: "app.ts is the entry point", "this team uses bcrypt", "payment always depends on the User model". That knowledge lives in OKF docs indexed in the local store. A competitor's agent — even a cheaper one — starts from zero on that codebase. **The longer you use MAO, the more expensive it is to leave.**

Build decisions that reinforce this:
- Every run writes OKF (success AND failure). No exceptions.
- Recall quality > recall speed. A wrong lesson recalled is worse than none.
- Project-scoped lessons are the moat; global lessons are commodity.

## 2. Parallel orchestration UX (feature nobody else ships)
No other open-source agent does: one prompt → N features built simultaneously in isolated sandboxes → coupled → verified, with live visibility into each worker. Claude Code is sequential. Aider is sequential. OpenCode subagents are in-process, not isolated sandboxes with waves.

Build decisions that reinforce this:
- The orchestration panel is a first-class surface, not a debug view. Users must SEE the parallelism.
- Waves (dependency-ordered execution) must be visible in the plan UI.
- Wall-clock time is a headline metric: "3 features in 1m45s" beats "3 features in 5m sequential".

## 3. Community OKF graph (network effect, later)
If hosted-tier users opt in to sharing anonymized global lessons ("React + Supabase patterns", "Express JWT pitfalls"), the collective memory becomes the product. A new user on day 1 inherits lessons from 1,000 prior builds. No single-user agent can replicate that.

Build decisions that reinforce this:
- OKF docs are portable markdown by design (OKF spec), not a proprietary blob.
- Global vs project scope separation exists from day 1 (PROMPTS.md `okf-writer`).
- Sharing is opt-in, anonymized, and never includes code — lessons only.

## What is NOT the moat
- Cheap models (anyone can call them)
- The planner prompt (copyable — keep it versioned, accept it leaks)
- jcode (MIT, anyone can fork it too)
- The cost claim itself (replicable in a weekend)

## The flywheel
```
more builds → more OKF lessons → better plans + fewer retries
  → lower cost per build → better headline numbers
    → more users → more builds
```
Every component either feeds this loop or it's optional.
