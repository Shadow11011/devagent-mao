import { describe, it, expect } from 'vitest';
import { decide, costOf, RATES, renderResultsMd } from '../../validation/report.js';

describe('costOf', () => {
  it('prices k3 and inkling-ref tokens', () => {
    // 1M in + 1M out on K3 = $3 + $15 = $18; same on inkling ref = $0.14 + $0.28 = $0.42
    expect(costOf({ orchestrator: { in: 1_000_000, out: 1_000_000 }, workers: { in: 0, out: 0 } })).toBeCloseTo(18, 5);
    expect(costOf({ orchestrator: { in: 0, out: 0 }, workers: { in: 1_000_000, out: 1_000_000 } })).toBeCloseTo(0.42, 5);
    expect(RATES.k3.input).toBe(3);
  });
});

describe('decide (VALIDATION.md kill/pivot table)', () => {
  it('GO when merge >= 70% and cost <= 15%', () => {
    expect(decide({ mergeSuccess: 0.7, costRatio: 0.15, planQualityAvg: null, correctnessA: 0.7 }).call).toBe('GO');
  });
  it('REDESIGN-COUPLING between 40-70%', () => {
    expect(decide({ mergeSuccess: 0.5, costRatio: 0.1, planQualityAvg: null }).call).toBe('REDESIGN-COUPLING');
  });
  it('ARCHITECTURE-REWORK under 40%', () => {
    expect(decide({ mergeSuccess: 0.2, costRatio: 0.1, planQualityAvg: null }).call).toBe('ARCHITECTURE-REWORK');
  });
  it('PROMPT-ENGINEERING-FIRST when plan quality <= 2', () => {
    expect(decide({ mergeSuccess: 0.9, costRatio: 0.05, planQualityAvg: 2 }).call).toBe('PROMPT-ENGINEERING-FIRST');
  });
  it('REPRICE when correct but cost >= 30%', () => {
    expect(decide({ mergeSuccess: 0.8, costRatio: 0.3, planQualityAvg: null, correctnessA: 0.8 }).call).toBe('REPRICE');
  });
});

describe('renderResultsMd', () => {
  it('renders all 20 arms and the decision', () => {
    const mk = (taskId, arm, status) => ({ taskId, arm, status, verifyOk: status === 'verified', planFeatureCount: 2, mergeNeeded: 1, couplingEscalations: 0, attemptsTotal: 1, usage: { orchestrator: { in: 1, out: 1 }, workers: { in: 1, out: 1 } }, gpuLatencyMs: 1, wallClockMs: 1 });
    const metrics = Array.from({ length: 10 }, (_, i) => [mk(`t${i + 1}`, 'A', 'verified'), mk(`t${i + 1}`, 'B', 'verified')]).flat();
    const md = renderResultsMd(metrics, '2026-08-05T00:00:00Z');
    expect(md).toContain('| t6 | A |');
    expect(md).toContain('## Decision');
    expect(md).toContain('GO');
  });
});
