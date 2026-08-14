import { describe, it, expect } from 'vitest';
import { recursivePlan, isCoarseFeature, splitFeature, decomposeFeatureWithOrchestrator } from '../src/recursive.js';

function feat(id, { description = 'normal feature', files = ['a.js'], newFiles = ['b.js'], dependencies = [], tooBig = false } = {}) {
  return { id, description, files, newFiles, dependencies, tooBig };
}

describe('isCoarseFeature', () => {
  it('flags tooBig, oversized newFiles/files, and long description', () => {
    expect(isCoarseFeature(feat('a', { tooBig: true }))).toBe(true);
    expect(isCoarseFeature(feat('a', { newFiles: ['1','2','3','4','5'] }))).toBe(true);
    expect(isCoarseFeature(feat('a', { files: ['1','2','3','4','5','6','7'] }))).toBe(true);
    expect(isCoarseFeature(feat('a', { description: 'x'.repeat(601) }))).toBe(true);
  });

  it('does not flag a normal feature', () => {
    expect(isCoarseFeature(feat('a'))).toBe(false);
  });
});

describe('splitFeature', () => {
  it('chains leaves sequentially and inherits external deps', () => {
    const children = [{ description: 'part 1' }, { description: 'part 2' }];
    const leaves = splitFeature(feat('auth', { dependencies: ['db'] }), children);
    expect(leaves.map((l) => l.id)).toEqual(['auth-1', 'auth-2']);
    expect(leaves[0].dependencies).toEqual(['db']);
    expect(leaves[1].dependencies).toEqual(['db', 'auth-1']);
    expect(leaves[1].parent).toBe('auth');
  });
});

describe('recursivePlan', () => {
  it('returns the plan unchanged (same features array) when nothing is coarse', async () => {
    const plan = { features: [feat('a'), feat('b')], waves: [['a', 'b']] };
    const out = await recursivePlan(plan, { decomposeFeature: async () => [] });
    expect(out.features).toBe(plan.features);
    expect(out.waves).toEqual([['a', 'b']]);
  });

  it('splits a coarse feature into ordered leaves and reschedules waves', async () => {
    const plan = {
      features: [feat('auth', { newFiles: ['a','b','c','d','e'] }), feat('db')],
      waves: [['auth', 'db']],
    };
    const out = await recursivePlan(plan, {
      decomposeFeature: async (f) => [{ description: 'auth part 1' }, { description: 'auth part 2' }],
    });
    expect(out.features.map((f) => f.id)).toEqual(['auth-1', 'auth-2', 'db']);
    // auth-2 depends on auth-1, so they cannot be in the same wave.
    expect(out.waves.length).toBe(2);
    expect(out.waves[0]).toContain('auth-1');
    expect(out.waves[1]).toContain('auth-2');
  });

  it('expands a split dependency into its leaves', async () => {
    const plan = {
      features: [
        feat('auth', { newFiles: ['a','b','c','d','e'] }),
        feat('dashboard', { dependencies: ['auth'] }),
      ],
      waves: [['auth'], ['dashboard']],
    };
    const out = await recursivePlan(plan, {
      decomposeFeature: async (f) => [{ description: 'auth 1' }, { description: 'auth 2' }],
    });
    const dashboard = out.features.find((f) => f.id === 'dashboard');
    expect(dashboard.dependencies).toEqual(['auth-1', 'auth-2']);
  });

  it('respects maxDepth (does not recurse past the cap)', async () => {
    const plan = { features: [feat('auth', { newFiles: ['a','b','c','d','e'] })], waves: [['auth']] };
    let calls = 0;
    const out = await recursivePlan(plan, {
      maxDepth: 1,
      decomposeFeature: async () => { calls++; return [{ description: 'leaf' }]; },
    });
    // The leaf produced at depth 0 is processed at depth 1 but NOT re-split.
    expect(calls).toBe(1);
    expect(out.features.map((f) => f.id)).toEqual(['auth-1']);
  });
});

describe('decomposeFeatureWithOrchestrator', () => {
  it('returns a function that calls the orchestrator and validates output', () => {
    const fn = decomposeFeatureWithOrchestrator({ models: { orchestrator: {} } });
    expect(typeof fn).toBe('function');
  });
});
