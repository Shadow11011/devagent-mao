export const RATES = { k3: { input: 3, output: 15 }, inklingRef: { input: 0.14, output: 0.28 } }; // $ per 1M; inklingRef = DeepSeek-V4-Flash reference pricing for the product comparison

export function costOf(usage) {
  const o = cost(RATES.k3, usage.orchestrator);
  const w = cost(RATES.inklingRef, usage.workers);
  return o + w;
}
const cost = (r, u) => (u.in / 1e6) * r.input + (u.out / 1e6) * r.output;

export function decide({ mergeSuccess, costRatio, planQualityAvg }) {
  if (planQualityAvg !== null && planQualityAvg <= 2) return { call: 'PROMPT-ENGINEERING-FIRST', note: 'Plans are bad; prompt work before any code.' };
  if (mergeSuccess >= 0.7 && costRatio <= 0.15) return { call: 'GO', note: 'Merge success >= 70% and MAO cost <= 15% of single-model.' };
  if (mergeSuccess >= 0.7 && costRatio >= 0.3) return { call: 'REPRICE', note: 'Correct but MAO cost >= 30% of single-model: reprice or shed orchestrator tokens.' };
  if (mergeSuccess >= 0.4) return { call: 'REDESIGN-COUPLING', note: 'Coupling needs stronger model or smaller feature scope; re-run t6/t7/t9.' };
  return { call: 'ARCHITECTURE-REWORK', note: 'Merge success < 40%: consider single-worker + memory only.' };
}
// Note: REPRICE is decided directly in decide() (merge >= 0.7 && costRatio >= 0.3), disjoint from the GO
// window (costRatio <= 0.15); the 0.15-0.30 band still falls through to REDESIGN-COUPLING per the doc's ordering.

export function summarize(metrics) {
  const armA = metrics.filter((m) => m.arm === 'A');
  const armB = metrics.filter((m) => m.arm === 'B');
  const mergeSuccess = armA.length ? armA.filter((m) => m.verifyOk).length / armA.length : 0;
  const costA = armA.reduce((s, m) => s + costOf(m.usage), 0);
  const costB = armB.reduce((s, m) => s + costOf(m.usage), 0);
  return { mergeSuccess, costA, costB, costRatio: costB > 0 ? costA / costB : null, planQualityAvg: null };
}

export function renderResultsMd(metrics, generatedAt) {
  const s = summarize(metrics);
  const merged = metrics.filter((m) => m.arm === 'A' && m.mergeNeeded > 0);
  const mergesClean = merged.filter((m) => m.verifyOk).length;
  const mergeRate = merged.length ? mergesClean / merged.length : 0;
  let d;
  if (merged.length && mergeRate < 0.4) d = { call: 'ARCHITECTURE-REWORK', note: `Coupling clean rate ${(mergeRate * 100).toFixed(0)}% < 40%` };
  else if (merged.length && mergeRate < 0.7) d = { call: 'REDESIGN-COUPLING', note: `Coupling clean rate ${(mergeRate * 100).toFixed(0)}% in 40-70% band` };
  else d = decide({ mergeSuccess: s.mergeSuccess, costRatio: s.costRatio ?? 1, planQualityAvg: null });
  const rows = metrics.map((m) => `| ${m.taskId} | ${m.arm} | ${m.status} | ${m.planFeatureCount ?? '-'} | ${m.attemptsTotal} | ${m.couplingEscalations} | ${m.usage.orchestrator.in + m.usage.orchestrator.out} | ${m.usage.workers.in + m.usage.workers.out} | ${(m.wallClockMs / 1000).toFixed(0)}s |`).join('\n');
  return `# VALIDATION-RESULTS — DevAgent MAO on K3 (orchestrator) + Inkling (workers)

> Generated: ${generatedAt}. Protocol: VALIDATION.md (10 tasks, Arm A = MAO pipeline, Arm B = single K3 worker, same sandbox adapter, same hidden-test verification).
> Adaptations: t3 framework-free TS (no jsdom infra); t10 = t6 with orchestratorEffort=high (stands in for the Fable-5 arm). Cost uses published K3 rates and DeepSeek-V4-Flash reference rates for Inkling tokens (Inkling is self-hosted GPU; GPU latency recorded separately).

| Task | Arm | Result | Features | Worker attempts | Coupling escalations | Orch tokens | Worker tokens | Wall clock |
|------|-----|--------|----------|-----------------|----------------------|-------------|---------------|------------|
${rows}

## Decision

- Merge success (Arm A verified, all tasks): **${(s.mergeSuccess * 100).toFixed(0)}%**
- Coupling clean rate (Arm A tasks needing merges): **${(mergeRate * 100).toFixed(0)}%** (${mergesClean}/${merged.length})
- Cost: Arm A $${s.costA.toFixed(3)} vs Arm B $${s.costB.toFixed(3)} (reference pricing) → ratio ${s.costRatio === null ? 'n/a' : s.costRatio.toFixed(2)}
- **Call: ${d.call}** — ${d.note}

Kill/pivot thresholds applied from VALIDATION.md: GO = merge ≥70% AND cost ≤15%; 40-70% = redesign coupling (re-run t6/t7/t9); <40% = architecture rework. Plan-quality (1-5, human) is intentionally null — fill after reviewing 3 plans by hand in validation/results/*-A.json.
`;
}
