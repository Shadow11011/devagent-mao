# TESTING — strategy for a parallel multi-agent system

> Multi-agent builds fail in ways single-agent systems never see: merge skew, wave races, half-dead sandboxes. Tests must exist BEFORE the orchestrator, not after.

## Layers

### 1. Unit tests
- Planner output parser (strict JSON, malformed input, one re-ask).
- Wave scheduler (dependency ordering, cycle detection).
- Coupler diff logic (non-overlapping = copy, overlapping = model call).
- OKF store/recall (insert, dedupe >0.9 similarity, scope filtering).
- All with **mock LLM responses** — no live API calls in unit tests.

### 2. Integration tests (mock sandbox)
Using `MockSandboxAdapter` (SANDBOX-INTERFACE.md):
- Spawn 2 mock sandboxes → workers write disjoint files → couple → output present.
- Overlapping-file case → coupler invoked → merged file contains both intents.
- Wave 2 sandbox sees Wave 1's coupled output.

### 3. Golden tests (CI gate)
10 canonical tasks (mirror VALIDATION.md tasks) with recorded mock LLM responses:
- Run full pipeline offline on every PR.
- Assert: plan shape, wave order, coupling invoked when expected, verification pass/fail.
- **Prompt changes MUST re-run goldens.** A prompt edit that changes planner output on a golden task is a visible diff in CI.

### 4. Cost regression tests
- Assert total tokens per golden task stays within ±20% of baseline.
- Prevents "prompt got chattier, builds cost 2×" regressions silently shipping.

### 5. Chaos tests
- Kill a sandbox mid-build → coordinator marks crashed, restarts, no retry penalty, build completes.
- Sandbox returns garbage diff → judge fails it → retry path with OKF lesson.
- API 429 from provider → rate limiter serializes, build slows but completes.
- OOM injection → graceful degradation to serialized builds.

### 6. Live smoke tests (manual, pre-release)
- One real build per engine (linux/macos/windows/fallback) on a real repo with real API keys.
- Cost within expected band ($0.94-$1.38/build for the canonical 3-feature task).

## What we don't test
- LLM output *quality* in CI (non-deterministic). Quality is measured in VALIDATION.md, gated by humans, not by CI.

## CI
`.github/workflows/`: lint → unit → integration (mock sandbox) → goldens → cost regression. Chaos suite nightly, not per-PR.
