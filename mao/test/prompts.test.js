import { describe, it, expect } from 'vitest';
import { loadPrompt, renderPrompt } from '../src/prompts.js';

describe('prompts', () => {
  it('loads every template file', () => {
    for (const name of ['planner.v1', 'worker.v1', 'judge.v1', 'coupler.v1', 'verifier-fix.v1', 'face.v1']) {
      const t = loadPrompt(name);
      expect(typeof t).toBe('string');
      expect(t.length).toBeGreaterThan(50);
    }
  });
  it('renders vars and throws on missing', () => {
    expect(renderPrompt('a {{X}} c', { X: 'b' })).toBe('a b c');
    expect(() => renderPrompt('a {{X}} c', {})).toThrow(/Missing prompt var/);
  });
  it('planner template mentions the contract keys', () => {
    const t = loadPrompt('planner.v1');
    for (const k of ['features', 'sharedFiles', 'waves', 'dependencies', 'OKF_CONTEXT']) expect(t).toContain(k);
  });
});
