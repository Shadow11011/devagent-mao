import { describe, it, expect } from 'vitest';
import { attemptDelta, summarizePhaseE } from '../validation/phaseE.js';

describe('attemptDelta', () => {
  it('is positive when warm uses fewer attempts', () => {
    expect(attemptDelta({ coldAttempts: 3, warmAttempts: 1 })).toBe(2);
  });
  it('is zero when unchanged', () => {
    expect(attemptDelta({ coldAttempts: 2, warmAttempts: 2 })).toBe(0);
  });
  it('is negative when warm uses more attempts', () => {
    expect(attemptDelta({ coldAttempts: 1, warmAttempts: 3 })).toBe(-2);
  });
});

describe('summarizePhaseE', () => {
  it('sums cold and warm attempts and computes delta', () => {
    const rows = [
      { taskId: 't1', coldAttempts: 2, warmAttempts: 1, delta: 1 },
      { taskId: 't2', coldAttempts: 3, warmAttempts: 2, delta: 1 },
      { taskId: 't3', coldAttempts: 6, warmAttempts: 6, delta: 0 },
    ];
    const s = summarizePhaseE(rows);
    expect(s.cold).toBe(11);
    expect(s.warm).toBe(9);
    expect(s.delta).toBe(2);
    expect(s.tasks).toBe(3);
  });
});
