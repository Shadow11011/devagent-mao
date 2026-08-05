import fsp from 'node:fs/promises';
import path from 'node:path';
import { chat } from './modelClient.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { extractBuildRequest, guidedCheck } from './chat.js';
import { planBuild } from './planner.js';
import { runPipeline } from './coordinator.js';
import { LocalAdapter } from './sandbox.js';
import { scanProject } from './scanner.js';

// Client-agnostic conversation + build engine. Owns chat sessions on disk, runs the
// face model per turn, proposes a plan when the face emits a BUILD_REQUEST marker,
// and orchestrates accepted plans through runPipeline — streaming engine events to
// subscribers so any client (CLI, web, TUI) can render progress.
export class MaoEngine {
  constructor(cfg, store, { runPipeline: pipeline = runPipeline } = {}) {
    this.cfg = cfg;
    this.store = store;
    this.pipeline = pipeline; // injectable for tests
    this.subscribers = new Set();
    this.sessionsDir = path.join(cfg.dataDir, 'sessions');
  }

  subscribe(fn) { this.subscribers.add(fn); return fn; }
  unsubscribe(fn) { this.subscribers.delete(fn); }
  emit(ev) { for (const fn of this.subscribers) fn(ev); }

  sessionPath(id) { return path.join(this.sessionsDir, `${id}.json`); }
  async save(session) { await fsp.writeFile(this.sessionPath(session.id), JSON.stringify(session, null, 2)); }

  async newChat({ sourceDir, mode = 'cheap' }) {
    const id = `chat-${Math.random().toString(36).slice(2, 8)}`;
    await fsp.mkdir(this.sessionsDir, { recursive: true });
    await this.save({ id, mode, sourceDir, history: [], pendingPlan: null, createdAt: new Date().toISOString() });
    return id;
  }

  async getSession(id) {
    try { return JSON.parse(await fsp.readFile(this.sessionPath(id), 'utf8')); }
    catch { return null; }
  }

  async userTurn(id, text) {
    const session = await this.getSession(id);
    if (!session) { this.emit({ type: 'error', sessionId: id, message: `unknown session: ${id}` }); return; }
    session.history.push({ role: 'user', content: text });
    await this.save(session);
    try {
      const system = renderPrompt(loadPrompt('face.v1'), { PROJECT_DIR: session.sourceDir, MODE: session.mode });
      const faceReply = async () => {
        const r = await chat(this.cfg.models.worker, { messages: [{ role: 'system', content: system }, ...session.history], reasoningEffort: this.cfg.models.worker.reasoningEffort, apiKey: this.cfg.apiKey, timeoutMs: this.cfg.requestTimeoutMs, maxTokens: 4096 });
        return r.content;
      };
      let reply = await faceReply();
      if (session.mode === 'guided') {
        const chk = await guidedCheck(this.cfg, { conversationTail: session.history.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n'), assistantReply: reply });
        this.emit({ type: 'guided-check', sessionId: id, ok: chk.ok, objection: chk.objection });
        if (!chk.ok && chk.objection) {
          session.history.push({ role: 'assistant', content: reply }, { role: 'user', content: `[orchestrator objection: ${chk.objection}] Correct your reply.` });
          await this.save(session);
          reply = await faceReply();
        }
      }
      session.history.push({ role: 'assistant', content: reply });
      await this.save(session);
      this.emit({ type: 'face-reply', sessionId: id, content: reply });
      const task = extractBuildRequest(reply);
      if (task) {
        const { summary } = scanProject(session.sourceDir);
        const { plan } = await planBuild(this.cfg, { summary, okfContext: '', prompt: task });
        session.pendingPlan = { task, plan };
        await this.save(session);
        this.emit({ type: 'plan-proposal', sessionId: id, task, plan });
      }
    } catch (err) {
      await this.save(session);
      this.emit({ type: 'error', sessionId: id, message: err.message });
    }
  }

  async approve(id, accept) {
    const session = await this.getSession(id);
    if (!session) { this.emit({ type: 'error', sessionId: id, message: `unknown session: ${id}` }); return; }
    const pending = session.pendingPlan;
    if (!pending) { this.emit({ type: 'error', sessionId: id, message: `no pending plan proposal for session: ${id}` }); return; }
    session.pendingPlan = null;
    if (!accept) {
      session.history.push({ role: 'assistant', content: 'Understood, not building.' });
      await this.save(session);
      this.emit({ type: 'plan-rejected', sessionId: id });
      return;
    }
    await this.save(session);
    const runId = this.store.newRunId();
    let rec;
    try {
      rec = await this.pipeline(
        { cfg: this.cfg, store: this.store, adapter: new LocalAdapter(this.store.sandboxesPath(runId)), emit: (t, d) => this.emit({ type: 'run-event', sessionId: id, runId, event: [t, d] }) },
        { task: pending.task, sourceDir: session.sourceDir, runId },
      );
    } catch (err) {
      await this.save(session);
      this.emit({ type: 'error', sessionId: id, runId, message: err.message });
      return;
    }
    this.emit({ type: 'run-final', sessionId: id, runId, status: rec.status });
    const statusLine = rec.status === 'verified' ? `Build verified (${rec.runId ?? runId}).` : `Build failed (${rec.runId ?? runId}): ${rec.error ?? 'see run.json'}`;
    session.history.push({ role: 'user', content: `[build result: ${statusLine}]` });
    await this.save(session);
    return rec;
  }
}
