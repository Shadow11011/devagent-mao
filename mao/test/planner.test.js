import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validatePlan, scheduleWaves, planBuild } from '../src/planner.js';

const okPlan = {
  features: [
    { id: 'auth', description: 'a', files: ['src/app.js'], newFiles: ['src/auth.js'], dependencies: [] },
    { id: 'pay', description: 'b', files: ['src/app.js', 'src/auth.js'], newFiles: ['src/pay.js'], dependencies: ['auth'] },
    { id: 'dash', description: 'c', files: ['src/app.js'], newFiles: ['src/dash.js'], dependencies: [] },
  ],
  sharedFiles: ['src/app.js'],
  waves: [['auth', 'dash'], ['pay']],
};

beforeEach(() => vi.restoreAllMocks());

describe('validatePlan', () => {
  it('accepts and normalizes', () => {
    const p = validatePlan(okPlan);
    expect(p.features).toHaveLength(3);
    expect(p.waves).toEqual([['auth', 'dash'], ['pay']]);
  });
  it('dup-id wave falls back to scheduleWaves', () => {
    const p = validatePlan({ ...okPlan, waves: [['auth', 'dash'], ['auth']] }); // 'auth' twice, 'pay' missing
    expect(p.waves).toEqual(scheduleWaves(okPlan.features));
    expect(p.waves).toEqual([['auth', 'dash'], ['pay']]);
  });
  it('topo-invalid wave falls back and produces the correct order', () => {
    const p = validatePlan({ ...okPlan, waves: [['pay'], ['auth', 'dash']] }); // pay's dep 'auth' sits in a later wave
    expect(p.waves).toEqual([['auth', 'dash'], ['pay']]);
  });
  it('rejects dup ids, unknown deps, empty features', () => {
    expect(() => validatePlan({ features: [], waves: [] })).toThrow();
    expect(() => validatePlan({ features: [{ ...okPlan.features[0] }, { ...okPlan.features[0] }] })).toThrow(/duplicate/i);
    expect(() => validatePlan({ features: [{ ...okPlan.features[0], dependencies: ['nope'] }] })).toThrow(/unknown dependency/i);
  });
});

describe('scheduleWaves', () => {
  it('orders by dependencies', () => {
    expect(scheduleWaves(okPlan.features)).toEqual([['auth', 'dash'], ['pay']]);
  });
  it('detects cycles', () => {
    const cyc = [
      { id: 'a', description: '', files: [], newFiles: [], dependencies: ['b'] },
      { id: 'b', description: '', files: [], newFiles: [], dependencies: ['a'] },
    ];
    expect(() => scheduleWaves(cyc)).toThrow(/cycle/i);
  });
});

describe('planBuild', () => {
  it('calls chatJson with schema + returns plan and usage', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify(okPlan) } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }) }));
    const cfg = { apiKey: 'k', models: { orchestrator: { baseUrl: 'http://x/v1', model: 'm', reasoningEffort: 'low' } } };
    const r = await planBuild(cfg, { summary: 'S', prompt: 'build stuff' });
    expect(r.plan.features).toHaveLength(3);
    expect(r.usage.total).toBe(3);
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.response_format.json_schema.name).toBe('plan');
  });
});
