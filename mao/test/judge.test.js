import { describe, it, expect, vi, beforeEach } from 'vitest';
import { judgeFeature } from '../src/judge.js';

const CFG = { apiKey: 'k', requestTimeoutMs: 1000, models: { orchestrator: { baseUrl: 'http://x/v1', model: 'm', reasoningEffort: 'low' } } };
const verdictBody = (v) => JSON.stringify({ choices: [{ message: { content: JSON.stringify(v) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
beforeEach(() => vi.restoreAllMocks());

describe('judgeFeature', () => {
  it('parses pass verdict', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => verdictBody({ verdict: 'pass', failureClass: null, reason: 'ok', lesson: null }) }));
    const r = await judgeFeature(CFG, { feature: { description: 'd' }, diffInfo: { diff: 'x' }, gateLog: '', summary: 's' });
    expect(r.verdict).toBe('pass');
    expect(r.usage.total).toBe(2);
  });
  it('rejects bad verdict values via schema validate', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => verdictBody({ verdict: 'maybe', reason: '' }) }));
    await expect(judgeFeature(CFG, { feature: { description: 'd' }, diffInfo: { diff: 'x' }, gateLog: '', summary: 's' })).rejects.toThrow();
  });
});
