import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPipeline } from '../src/coordinator.js';
import { Store } from '../src/store.js';
import { LocalAdapter } from '../src/sandbox.js';
import { loadConfig } from '../src/config.js';

let root, src;
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mao-coord-'));
  src = path.join(root, 'proj'); mkdirSync(path.join(src, 'src'), { recursive: true });
  writeFileSync(path.join(src, 'package.json'), '{"name":"p","scripts":{"build":"node src/app.js"}}');
  writeFileSync(path.join(src, 'src', 'app.js'), 'console.log("base")\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function fakeApi(behavior) {
  return {
    planBuild: async () => ({ plan: { features: [
      { id: 'a', description: 'add a', files: ['src/app.js'], newFiles: ['src/a.js'], dependencies: [] },
      { id: 'b', description: 'add b (needs a)', files: ['src/app.js'], newFiles: ['src/b.js'], dependencies: ['a'] },
    ], sharedFiles: [], waves: [['a'], ['b']] }, usage: { prompt: 1, completion: 1, total: 2, cached: 0 }, attempts: 1 }),
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

describe('runPipeline', () => {
  it('runs waves in dependency order and writes run.json', async () => {
    const cfg = loadConfig({ dataDir: path.join(root, 'data1') });
    const store = new Store(cfg.dataDir);
    const events = [];
    const rec = await runPipeline(
      { cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx1')), emit: (t, d) => events.push(t), api: fakeApi() },
      { task: 'demo', sourceDir: src, runId: store.newRunId() },
    );
    expect(rec.status).toBe('verified');
    expect(Object.keys(rec.features).sort()).toEqual(['a', 'b']);
    expect(rec.totals.workers).toEqual({ input: 20, output: 10 });
    expect(events).toContain('plan');
    expect(events).toContain('wave-start');
    expect(events).toContain('verified');
    const onDisk = JSON.parse(readFileSync(path.join(store.runPath(rec.runId), 'run.json'), 'utf8'));
    expect(onDisk.status).toBe('verified');
  });

  it('retries failed worker with lesson, max attempts respected', async () => {
    let judgeCalls = 0;
    const api = fakeApi({ judgeFeature: async () => (++judgeCalls === 1 ? { verdict: 'fail', failureClass: 'logic', reason: 'bad', lesson: 'do X instead', usage: { prompt: 1, completion: 1, total: 2, cached: 0 } } : { verdict: 'pass', failureClass: null, reason: 'ok', lesson: null, usage: { prompt: 1, completion: 1, total: 2, cached: 0 } }) });
    const cfg = loadConfig({ dataDir: path.join(root, 'data2') });
    const store = new Store(cfg.dataDir);
    const rec = await runPipeline({ cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx2')), emit: () => { }, api }, { task: 'demo', sourceDir: src, runId: store.newRunId() });
    expect(rec.status).toBe('verified');
    const atts = Object.values(rec.features).map((f) => f.attempts);
    expect(Math.max(...atts)).toBe(2);
  });

  it('verification fix loop: fails once, fix applied, then passes', async () => {
    let verifyCalls = 0;
    const api = fakeApi({
      verifyCandidate: async () => (++verifyCalls === 1 ? { ok: false, stagePath: '', log: 'boom' } : { ok: true, stagePath: '', log: 'ok' }),
      requestVerifyFix: async () => ({ fixes: [{ path: 'src/app.js', content: 'console.log("fixed")\n' }], unfixable: false, reason: 'typo', usage: { prompt: 1, completion: 1, total: 2, cached: 0 } }),
    });
    const cfg = loadConfig({ dataDir: path.join(root, 'data3') });
    const store = new Store(cfg.dataDir);
    const rec = await runPipeline({ cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx3')), emit: () => { }, api }, { task: 'demo', sourceDir: src, runId: store.newRunId() });
    expect(rec.status).toBe('verified');
    expect(rec.verification.fixesApplied).toBe(1);
    expect(verifyCalls).toBe(2);
  });

  it('wave-1 outputs materialize into baseDir before wave-2 spawns', async () => {
    let mounted;
    const api = fakeApi({
      planBuild: async () => ({ plan: { features: [
        { id: 'a', description: 'add a', files: ['src/app.js'], newFiles: ['src/a.js'], dependencies: [] },
        { id: 'b', description: 'b reads a', files: ['src/app.js', 'src/a.js'], newFiles: ['src/b.js'], dependencies: ['a'] },
      ], sharedFiles: [], waves: [['a'], ['b']] }, usage: { prompt: 1, completion: 1, total: 2, cached: 0 }, attempts: 1 }),
      runWorker: async (cfg, adapter, sb, { feature }) => {
        if (feature.id === 'b') mounted = adapter.readFile(sb.id, 'src/a.js'); // mounted copy of wave-1's new file
        await adapter.exec(sb.id, { cmd: `echo "// ${feature.id}" > src/${feature.id}.js`, timeoutMs: 5000 });
        return { ok: true, summary: `built ${feature.id}`, text: '', usage: { input: 10, output: 5 }, durationMs: 1, gateLog: '' };
      },
    });
    const cfg = loadConfig({ dataDir: path.join(root, 'data5') });
    const store = new Store(cfg.dataDir);
    const rec = await runPipeline({ cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx5')), emit: () => { }, api }, { task: 'demo', sourceDir: src, runId: store.newRunId() });
    expect(rec.status).toBe('verified');
    expect(mounted).toBe('// a\n'); // wave-2 sandbox saw the exact content wave-1 produced
  });

  it('bounded free retry: repeated TIMEOUT exhausts the feature instead of hanging', async () => {
    let workerCalls = 0;
    const api = fakeApi({
      planBuild: async () => ({ plan: { features: [
        { id: 'a', description: 'add a', files: ['src/app.js'], newFiles: ['src/a.js'], dependencies: [] },
      ], sharedFiles: [], waves: [['a']] }, usage: { prompt: 1, completion: 1, total: 2, cached: 0 }, attempts: 1 }),
      runWorker: async () => { workerCalls++; return { ok: false, failureCode: 'TIMEOUT', failureDetail: 'endpoint down', usage: { input: 0, output: 0 }, durationMs: 1, gateLog: '' }; },
    });
    const cfg = loadConfig({ dataDir: path.join(root, 'data4') });
    const store = new Store(cfg.dataDir);
    const rec = await runPipeline({ cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx4')), emit: () => { }, api }, { task: 'demo', sourceDir: src, runId: store.newRunId() });
    expect(rec.features.a.exhausted).toBe(true);
    expect(rec.features.a.attempts).toBe(cfg.maxWorkerAttempts);
    expect(rec.features.a.wave).toBe(0);
    expect(workerCalls).toBe(cfg.maxWorkerAttempts + 1); // maxWorkerAttempts counted + 1 free infra retry
  });
});
