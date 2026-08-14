import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPipeline } from '../src/coordinator.js';
import { Store } from '../src/store.js';
import { LocalAdapter } from '../src/sandbox.js';
import { loadConfig } from '../src/config.js';

// End-to-end skills wiring: a project-local .mao/skills skill must be discovered
// and its rendered prompt block must reach the worker.

let root, src;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mao-skills-wire-'));
  src = path.join(root, 'proj'); mkdirSync(path.join(src, 'src'), { recursive: true });
  writeFileSync(path.join(src, 'package.json'), '{"name":"p"}');
  writeFileSync(path.join(src, 'src', 'app.js'), 'console.log(1)\n');
  const skillDir = path.join(src, '.mao', 'skills', 'pdf-tools');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: pdf-tools\ndescription: Extract text and tables from PDF files.\n---\n\n# PDF Tools\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeApi(behavior = {}) {
  return {
    planBuild: async () => ({ plan: { features: [
      { id: 'a', description: 'add a', files: ['src/app.js'], newFiles: ['src/a.js'], dependencies: [] },
    ], sharedFiles: [], waves: [['a']] }, usage: { prompt: 1, completion: 1, total: 2, cached: 0 }, attempts: 1 }),
    runWorker: async (cfg, adapter, sb, args) => {
      await adapter.exec(sb.id, { cmd: 'echo "// a" > src/a.js', timeoutMs: 5000 });
      return { ok: true, summary: 'built', text: '', usage: { input: 10, output: 5 }, durationMs: 1, gateLog: '', skillsContext: args.skillsContext };
    },
    judgeFeature: async () => ({ verdict: 'pass', failureClass: null, reason: 'ok', lesson: null, usage: { prompt: 1, completion: 1, total: 2, cached: 0 } }),
    coupleFile: async (cfg, { variants }) => ({ content: variants[0].content, conflicts: [], escalated: false, usage: { prompt: 0, completion: 0, total: 0, cached: 0 } }),
    verifyCandidate: async () => ({ ok: true, stagePath: '', log: 'ok' }),
    requestVerifyFix: async () => ({ fixes: null, unfixable: true, reason: 'n/a', usage: { prompt: 0, completion: 0, total: 0, cached: 0 } }),
    ...behavior,
  };
}

describe('skills wiring in runPipeline', () => {
  it('discovers project skills and passes the rendered block to the worker', async () => {
    let workerSkills = '';
    const api = fakeApi({
      runWorker: async (cfg, adapter, sb, args) => {
        workerSkills = args.skillsContext;
        await adapter.exec(sb.id, { cmd: 'echo "// a" > src/a.js', timeoutMs: 5000 });
        return { ok: true, summary: 'built', text: '', usage: { input: 10, output: 5 }, durationMs: 1, gateLog: '' };
      },
    });
    const cfg = loadConfig({ dataDir: path.join(root, 'data') });
    const store = new Store(cfg.dataDir);
    const rec = await runPipeline(
      { cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx')), emit: () => {}, api },
      { task: 'build pdf tools', sourceDir: src, runId: store.newRunId() },
    );
    expect(rec.status).toBe('verified');
    expect(workerSkills).toContain('pdf-tools');
    expect(workerSkills).toContain('<available_skills>');
  });

  it('disables skills discovery with MAO_SKILLS=0', async () => {
    let workerSkills = 'unset';
    const api = fakeApi({
      runWorker: async (cfg, adapter, sb, args) => {
        workerSkills = args.skillsContext;
        await adapter.exec(sb.id, { cmd: 'echo "// a" > src/a.js', timeoutMs: 5000 });
        return { ok: true, summary: 'built', text: '', usage: { input: 10, output: 5 }, durationMs: 1, gateLog: '' };
      },
    });
    const prev = process.env.MAO_SKILLS;
    process.env.MAO_SKILLS = '0';
    try {
      const cfg = loadConfig({ dataDir: path.join(root, 'data') });
      const store = new Store(cfg.dataDir);
      const rec = await runPipeline(
        { cfg, store, adapter: new LocalAdapter(path.join(root, 'sbx2')), emit: () => {}, api },
        { task: 'build pdf tools', sourceDir: src, runId: store.newRunId() },
      );
      expect(rec.status).toBe('verified');
      expect(workerSkills).toBe('');
    } finally {
      if (prev === undefined) delete process.env.MAO_SKILLS; else process.env.MAO_SKILLS = prev;
    }
  });
});
