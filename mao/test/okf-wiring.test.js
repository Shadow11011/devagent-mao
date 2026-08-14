import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPipeline } from '../src/coordinator.js';
import { Store } from '../src/store.js';
import { LocalAdapter } from '../src/sandbox.js';
import { loadConfig } from '../src/config.js';
import { createOkf } from '../src/okf/index.js';

// End-to-end OKF wiring: recall must reach the planner and worker, and a
// canonical doc must be written on both success and failure.

let root, src, okf, repoId;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mao-okf-wire-'));
  src = path.join(root, 'proj'); mkdirSync(path.join(src, 'src'), { recursive: true });
  writeFileSync(path.join(src, 'package.json'), '{"name":"p","scripts":{"build":"node src/app.js"}}');
  writeFileSync(path.join(src, 'src', 'app.js'), 'console.log("base")\n');
  okf = createOkf({ root: path.join(root, 'okf') });
  repoId = okf.store.repoHash(src);
  okf.record({ scope: 'project', repo: repoId, problemType: 'auth', evidence: { attempted: 'x', worked: 'y', failed: '', lesson: 'use rls for authz' } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeApi(behavior = {}) {
  return {
    planBuild: async (cfg, { okfContext }) => ({ plan: { features: [
      { id: 'auth', description: 'add auth with supabase', files: ['src/app.js'], newFiles: ['src/auth.js'], dependencies: [] },
    ], sharedFiles: [], waves: [['auth']] }, usage: { prompt: 1, completion: 1, total: 2, cached: 0 }, attempts: 1, okfContext }),
    runWorker: async (cfg, adapter, sb, { feature, okfContext }) => {
      await adapter.exec(sb.id, { cmd: `echo "// ${feature.id}" > src/${feature.id}.js`, timeoutMs: 5000 });
      return { ok: true, summary: `built ${feature.id}`, text: '', usage: { input: 10, output: 5 }, durationMs: 1, gateLog: '', okfContext };
    },
    judgeFeature: async () => ({ verdict: 'pass', failureClass: null, reason: 'ok', lesson: null, usage: { prompt: 1, completion: 1, total: 2, cached: 0 } }),
    coupleFile: async (cfg, { variants }) => ({ content: variants[0].content, conflicts: [], escalated: false, usage: { prompt: 0, completion: 0, total: 0, cached: 0 } }),
    verifyCandidate: async () => ({ ok: true, stagePath: '', log: 'ok' }),
    requestVerifyFix: async () => ({ fixes: null, unfixable: true, reason: 'n/a', usage: { prompt: 0, completion: 0, total: 0, cached: 0 } }),
    ...behavior,
  };
}

describe('OKF wiring in runPipeline', () => {
  it('recalls project-scoped lessons into the planner and worker, and records on success', async () => {
    let planOkf, workerOkf;
    const api = fakeApi({
      planBuild: async (cfg, args) => ({ plan: { features: [
        { id: 'auth', description: 'add auth with supabase', files: ['src/app.js'], newFiles: ['src/auth.js'], dependencies: [] },
      ], sharedFiles: [], waves: [['auth']] }, usage: { prompt: 1, completion: 1, total: 2, cached: 0 }, attempts: 1, okfContext: (planOkf = args.okfContext) }),
      runWorker: async (cfg, adapter, sb, args) => {
        workerOkf = args.okfContext;
        await adapter.exec(sb.id, { cmd: 'echo "// auth" > src/auth.js', timeoutMs: 5000 });
        return { ok: true, summary: 'built auth', text: '', usage: { input: 10, output: 5 }, durationMs: 1, gateLog: '' };
      },
    });
    const cfg = loadConfig({ dataDir: path.join(root, 'data') });
    const store = new Store(cfg.dataDir);
    const rec = await runPipeline(
      { cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx')), emit: () => {}, api, okf },
      { task: 'add supabase auth', sourceDir: src, runId: store.newRunId() },
    );
    expect(rec.status).toBe('verified');
    expect(planOkf).toContain('use rls for authz');
    expect(workerOkf).toContain('use rls for authz');
    expect(rec.okf.recorded).toBe(true);
    // A canonical doc exists now beyond the seeded one.
    expect(okf.store.allDocs().length).toBeGreaterThanOrEqual(2);
  });

  it('records on failure too', async () => {
    const api = fakeApi({
      judgeFeature: async () => ({ verdict: 'fail', failureClass: 'logic', reason: 'bad', lesson: 'use rls instead', usage: { prompt: 1, completion: 1, total: 2, cached: 0 } }),
    });
    const cfg = loadConfig({ dataDir: path.join(root, 'data') });
    const store = new Store(cfg.dataDir);
    const rec = await runPipeline(
      { cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx2')), emit: () => {}, api, okf },
      { task: 'add supabase auth', sourceDir: src, runId: store.newRunId() },
    );
    expect(rec.status).toBe('failed');
    expect(rec.okf.recorded).toBe(true);
    const latest = okf.store.allDocs().sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? '')).at(-1);
    expect(latest.meta.type).toBe('failure');
  });
});
