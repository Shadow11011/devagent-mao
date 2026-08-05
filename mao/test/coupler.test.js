import { describe, it, expect, vi, beforeEach } from 'vitest';
import { coupleFile } from '../src/coupler.js';

const CFG = { apiKey: 'k', requestTimeoutMs: 1000, models: { orchestrator: { baseUrl: 'http://x/v1', model: 'm', reasoningEffort: 'low' } } };
const body = (o) => JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } });
beforeEach(() => vi.restoreAllMocks());

describe('coupleFile', () => {
  it('passes through a single variant without a model call', async () => {
    globalThis.fetch = vi.fn();
    const r = await coupleFile(CFG, { path: 'a.js', original: 'orig', variants: [{ featureId: 'f1', intent: 'x', content: 'v1' }] });
    expect(r.content).toBe('v1');
    expect(r.escalated).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('merges via model; escalates once when conflicts reported', async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => { n++; return { ok: true, status: 200, text: async () => body(n === 1 ? { merged: 'm1', conflicts: ['auth vs dash import order'] } : { merged: 'm2', conflicts: [] }) }; });
    const r = await coupleFile(CFG, { path: 'app.js', original: 'o', variants: [{ featureId: 'a', intent: 'i1', content: 'c1' }, { featureId: 'b', intent: 'i2', content: 'c2' }] });
    expect(r.content).toBe('m2');
    expect(r.escalated).toBe(true);
    expect(n).toBe(2);
  });
});
