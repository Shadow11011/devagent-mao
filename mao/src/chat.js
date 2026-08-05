import readline from 'node:readline';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { chat, chatJson } from './modelClient.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { runPipeline } from './coordinator.js';
import { Store } from './store.js';
import { LocalAdapter } from './sandbox.js';

export function extractBuildRequest(text) {
  let task = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('BUILD_REQUEST:')) task = line.slice('BUILD_REQUEST:'.length).trim();
  }
  return task;
}

const GUIDED_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' }, objection: { type: 'string' } }, required: ['ok', 'objection'], additionalProperties: false };

export async function guidedCheck(cfg, { conversationTail, assistantReply }) {
  const r = await chatJson(cfg.models.orchestrator, {
    messages: [
      { role: 'system', content: 'You are a senior engineer reviewing the conversation of a junior assistant. Object ONLY when the assistant made a technically wrong or dangerous claim/commitment. JSON only.' },
      { role: 'user', content: `Conversation tail:\n${conversationTail}\n\nAssistant reply under review:\n${assistantReply}` },
    ],
    jsonFormat: { type: 'json_schema', json_schema: { name: 'guided_check', strict: true, schema: GUIDED_SCHEMA } },
    validate: (o) => o,
    apiKey: cfg.apiKey, timeoutMs: cfg.requestTimeoutMs,
  });
  return { ...r.value, usage: r.usage };
}

export async function startChat(cfg, { sourceDir, mode = 'cheap', io = console }) {
  const store = new Store(cfg.dataDir);
  const sessionId = store.newRunId().replace('run-', 'chat-');
  const sessionFile = path.join(cfg.dataDir, 'sessions', `${sessionId}.json`);
  await fsp.mkdir(path.dirname(sessionFile), { recursive: true });
  const system = renderPrompt(loadPrompt('face.v1'), { PROJECT_DIR: sourceDir, MODE: mode });
  const history = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
  io.log(`MAO chat (${mode} mode) — project ${sourceDir}. /quit to exit.`);
  rl.prompt();
  const ask = (q) => new Promise((res) => rl.question(q, res));
  for await (const line of rl) {
    const input = line.trim();
    if (!input) { rl.prompt(); continue; }
    if (input === '/quit') break;
    history.push({ role: 'user', content: input });
    let reply = await faceReply();
    if (mode === 'guided') {
      const chk = await guidedCheck(cfg, { conversationTail: history.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n'), assistantReply: reply });
      if (!chk.ok && chk.objection) {
        history.push({ role: 'assistant', content: reply }, { role: 'user', content: `[orchestrator objection: ${chk.objection}] Correct your reply.` });
        reply = await faceReply();
      }
    }
    io.log(`mao> ${reply}`);
    history.push({ role: 'assistant', content: reply });
    const task = extractBuildRequest(reply);
    if (task) {
      const answer = (await ask(`\nPlan a build for: "${task}"? [y/N] `)).trim().toLowerCase();
      if (answer === 'y') {
        const runId = store.newRunId();
        const rec = await runPipeline(
          { cfg, store, adapter: new LocalAdapter(store.sandboxesPath(runId)), emit: (t, d) => io.log(`  [${t}] ${JSON.stringify(d)}`) },
          { task, sourceDir, runId },
        );
        const statusLine = rec.status === 'verified' ? `Build verified (${rec.runId}).` : `Build failed (${rec.runId}): ${rec.error ?? 'see run.json'}`;
        io.log(statusLine);
        history.push({ role: 'user', content: `[build result: ${statusLine}]` });
      } else {
        history.push({ role: 'assistant', content: 'Understood, not building.' });
      }
    }
    await fsp.writeFile(sessionFile, JSON.stringify({ id: sessionId, mode, sourceDir, history }, null, 2));
    rl.prompt();
  }
  rl.close();

  async function faceReply() {
    const r = await chat(cfg.models.worker, { messages: [{ role: 'system', content: system }, ...history], reasoningEffort: cfg.models.worker.reasoningEffort, apiKey: cfg.apiKey, timeoutMs: cfg.requestTimeoutMs, maxTokens: 4096 });
    return r.content;
  }
}
