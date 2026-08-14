import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPipeline } from '../src/coordinator.js';
import { Store } from '../src/store.js';
import { LocalAdapter } from '../src/sandbox.js';
import { loadConfig } from '../src/config.js';

let root, src;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mao-recursive-wire-'));
  src = path.join(root, 'proj'); mkdirSync(path.join(src, 'src'), { recursive: true });
  writeFileSync(path.join(src, 'package.json'), '{"name":"p"}');
  writeFileSync(path.join(src, 'src', 'app.js'), 'console.log(1)\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeApi(behavior = {}) {
  return {
    planBuild: async () => ({ plan: { features: [
      { id: 'big', description: 'big feature', files: ['src/app.js'], newFiles: ['a','b','c','d','e'], dependencies: [] },
    ], sharedFiles: [], waves: [['big']] }, usage: { prompt: 1, completion: 1, total: 2, cached: 0 }, attempts: 1 }),
    runWorker: async (cfg, adapter, sb, { feature }) => {
      await adapter.exec(sb.id, { cmd: `echo "// ${feature.id}" > src/${feature.id}.js`, timeoutMs: 5000 });
      return { ok: true, summary: `built ${feature.id}`, text: '', usage: { input: 10, output: 5 }, durationMs: 1, gateLog: '' };
    },
    judgeFeature: async () => ({ verdict: 'pass', failureClass: null, reason: 'ok', lesson: null, usage: { prompt: 1, completion: 1, total: 2, cached: 0 } }),
    coupleFile: async (cfg, { variants }) => ({ content: variants[0].content, conflicts: [], escalated: false, usage: { prompt: 0, completion: 0, total: 0, cached: 0 } }),
    verifyCandidate: async () => ({ ok: true, stagePath: '', log: 'ok' }),
    requestVerifyFix: async () => ({ fixes: null, unfixable: true, reason: 'n/a', usage: { prompt: 0, completion: 0, total: 0, cached: 0 } }),
    ...behavior,
  };
}

describe('recursive gating in runPipeline', () => {
  it('gate off: flat plan passes through unchanged (one feature)', async () => {
    const cfg = loadConfig({ dataDir: path.join(root, 'data') });
    const store = new Store(cfg.dataDir);
    const rec = await runPipeline(
      { cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx')), emit: () => {}, api: fakeApi() },
      { task: 'build big thing', sourceDir: src, runId: store.newRunId() },
    );
    expect(rec.status).toBe('verified');
    expect(rec.plan.features.map((f) => f.id)).toEqual(['big']);
    expect(rec.recursive).toBeUndefined();
  });

  it('gate on: coarse feature is decomposed into leaves', async () => {
    const cfg = loadConfig({ dataDir: path.join(root, 'data'), recursive: true });
    const store = new Store(cfg.dataDir);
    const decomposeFeature = async () => [{ description: 'part 1' }, { description: 'part 2' }];
    const rec = await runPipeline(
      { cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx')), emit: () => {}, api: fakeApi(), decomposeFeature },
      { task: 'build big thing', sourceDir: src, runId: store.newRunId() },
    );
    expect(rec.status).toBe('verified');
    expect(rec.plan.features.map((f) => f.id)).toEqual(['big-1', 'big-2']);
    expect(rec.recursive.enabled).toBe(true);
    expect(rec.recursive.featuresAfter).toBe(2);
  });
});
