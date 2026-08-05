import { describe, it, expect } from 'vitest';
import { TASKS } from '../../validation/tasks.js';

describe('VALIDATION task set', () => {
  it('has 10 tasks mirroring VALIDATION.md', () => {
    expect(TASKS).toHaveLength(10);
    const ids = TASKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(10);
  });
  it('every task has prompt, verifyCommands; fixtures have files; clones have url+ref', () => {
    for (const t of TASKS) {
      expect(typeof t.prompt).toBe('string');
      expect(t.prompt.length).toBeGreaterThan(40);
      expect(Array.isArray(t.verifyCommands)).toBe(true);
      expect(t.verifyCommands.length).toBeGreaterThan(0);
      if (t.kind === 'fixture') { expect(Object.keys(t.fixture.files).length).toBeGreaterThan(1); }
      else { expect(t.repoUrl).toMatch(/^https:/); expect(typeof t.ref).toBe('string'); }
    }
  });
  it('t10 is the t6 fixture with high orchestrator effort', () => {
    const t6 = TASKS.find((t) => t.id === 't6');
    const t10 = TASKS.find((t) => t.id === 't10');
    expect(t10.orchestratorEffort).toBe('high');
    expect(t10.fixture).toEqual(t6.fixture);
  });
});
