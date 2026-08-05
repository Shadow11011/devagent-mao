import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MaoEngine } from '../src/engine.js';
import { Store } from '../src/store.js';
import { loadConfig } from '../src/config.js';

let root, src;
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mao-engine-'));
  src = path.join(root, 'proj'); mkdirSync(path.join(src, 'src'), { recursive: true });
  writeFileSync(path.join(src, 'package.json'), '{"name":"p","scripts":{"build":"node src/app.js"}}');
  writeFileSync(path.join(src, 'src', 'app.js'), 'console.log("base")\n');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => vi.restoreAllMocks());

const completion = (content) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) });
const okPlan = {
  features: [{ id: 'a', description: 'add a', files: ['src/app.js'], newFiles: ['src/a.js'], dependencies: [] }],
  sharedFiles: [], waves: [['a']],
};

let dataSeq = 0;
function setup() {
  const cfg = loadConfig({ dataDir: path.join(root, `data${dataSeq++}`) });
  const store = new Store(cfg.dataDir);
  return { cfg, store };
}

describe('MaoEngine', () => {
  it('newChat creates a persisted session with chat-<6 base36> id', async () => {
    const { cfg, store } = setup();
    const engine = new MaoEngine(cfg, store);
    const id = await engine.newChat({ sourceDir: src });
    expect(id).toMatch(/^chat-[a-z0-9]{6}$/);
    const onDisk = JSON.parse(readFileSync(path.join(cfg.dataDir, 'sessions', `${id}.json`), 'utf8'));
    expect(onDisk).toMatchObject({ id, mode: 'cheap', sourceDir: src, history: [], pendingPlan: null });
    expect((await engine.getSession(id)).id).toBe(id);
    expect(await engine.getSession('chat-nope')).toBeNull();
  });

  it('cheap turn without marker: face-reply only, history persisted', async () => {
    const { cfg, store } = setup();
    globalThis.fetch = vi.fn(async () => completion('Happy to chat — no build needed here.'));
    const engine = new MaoEngine(cfg, store);
    const events = [];
    engine.subscribe((e) => events.push(e));
    const id = await engine.newChat({ sourceDir: src });
    await engine.userTurn(id, 'hello there');
    expect(events.map((e) => e.type)).toEqual(['face-reply']);
    expect(events[0]).toMatchObject({ sessionId: id, content: expect.stringContaining('Happy to chat') });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][0]).toContain(cfg.models.worker.baseUrl);
    const onDisk = JSON.parse(readFileSync(path.join(cfg.dataDir, 'sessions', `${id}.json`), 'utf8'));
    expect(onDisk.history).toEqual([{ role: 'user', content: 'hello there' }, { role: 'assistant', content: 'Happy to chat — no build needed here.' }]);
    expect(onDisk.pendingPlan).toBeNull();
  });

  it('marker turn: face-reply then plan-proposal, pendingPlan persisted', async () => {
    const { cfg, store } = setup();
    const replies = [completion('On it.\nBUILD_REQUEST: Add GET /health to the app.'), completion(JSON.stringify(okPlan))];
    globalThis.fetch = vi.fn(async () => replies.shift());
    const engine = new MaoEngine(cfg, store);
    const events = [];
    engine.subscribe((e) => events.push(e));
    const id = await engine.newChat({ sourceDir: src });
    await engine.userTurn(id, 'add a health endpoint');
    expect(events.map((e) => e.type)).toEqual(['face-reply', 'plan-proposal']);
    expect(events[1]).toMatchObject({ sessionId: id, task: 'Add GET /health to the app.' });
    expect(events[1].plan.features.map((f) => f.id)).toEqual(['a']);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch.mock.calls[0][0]).toContain(cfg.models.worker.baseUrl);
    expect(globalThis.fetch.mock.calls[1][0]).toContain(cfg.models.orchestrator.baseUrl); // planner posts to orchestrator
    const s = await engine.getSession(id);
    expect(s.pendingPlan.task).toBe('Add GET /health to the app.');
    expect(s.pendingPlan.plan.waves).toEqual([['a']]);
  });

  it('approve(true) runs injected pipeline and emits run-event + run-final', async () => {
    const { cfg, store } = setup();
    const replies = [completion('On it.\nBUILD_REQUEST: Add GET /health to the app.'), completion(JSON.stringify(okPlan))];
    globalThis.fetch = vi.fn(async () => replies.shift());
    const fakePipeline = vi.fn(async (deps, opts) => {
      deps.emit('wave-start', { wave: 0, features: ['a'] });
      return { runId: opts.runId, status: 'verified' };
    });
    const engine = new MaoEngine(cfg, store, { runPipeline: fakePipeline });
    const events = [];
    engine.subscribe((e) => events.push(e));
    const id = await engine.newChat({ sourceDir: src });
    await engine.userTurn(id, 'build it');
    events.length = 0;
    await engine.approve(id, true);
    expect(fakePipeline).toHaveBeenCalledTimes(1);
    expect(fakePipeline.mock.calls[0][1]).toMatchObject({ task: 'Add GET /health to the app.', sourceDir: src, runId: expect.stringMatching(/^run-/) });
    const final = events.filter((e) => e.type === 'run-final');
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({ sessionId: id, status: 'verified' });
    const runEvents = events.filter((e) => e.type === 'run-event');
    expect(runEvents).toHaveLength(1);
    expect(runEvents[0].event).toEqual(['wave-start', { wave: 0, features: ['a'] }]);
    expect(runEvents[0].runId).toBe(final[0].runId);
    const s = await engine.getSession(id);
    expect(s.pendingPlan).toBeNull();
    expect(s.history.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('[build result: Build verified') });
  });

  it('approve(false) rejects: plan-rejected event, pendingPlan cleared, history note', async () => {
    const { cfg, store } = setup();
    const replies = [completion('On it.\nBUILD_REQUEST: Add GET /health to the app.'), completion(JSON.stringify(okPlan))];
    globalThis.fetch = vi.fn(async () => replies.shift());
    const engine = new MaoEngine(cfg, store, { runPipeline: vi.fn() });
    const events = [];
    engine.subscribe((e) => events.push(e));
    const id = await engine.newChat({ sourceDir: src });
    await engine.userTurn(id, 'build it');
    events.length = 0;
    await engine.approve(id, false);
    expect(events.map((e) => e.type)).toEqual(['plan-rejected']);
    expect(engine.pipeline).not.toHaveBeenCalled();
    const s = await engine.getSession(id);
    expect(s.pendingPlan).toBeNull();
    expect(s.history.at(-1).content).toMatch(/not building/i);
    expect(existsSync(path.join(cfg.dataDir, 'sessions', `${id}.json`))).toBe(true);
  });

  it('approve without pending plan emits error; unsubscribe stops events', async () => {
    const { cfg, store } = setup();
    const engine = new MaoEngine(cfg, store);
    const events = [];
    const fn = (e) => events.push(e);
    engine.subscribe(fn);
    const id = await engine.newChat({ sourceDir: src });
    await engine.approve(id, true);
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect(events[0].message).toMatch(/no pending plan/);
    engine.unsubscribe(fn);
    await engine.approve(id, true);
    expect(events).toHaveLength(1);
  });
});
