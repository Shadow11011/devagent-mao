#!/usr/bin/env node
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { LocalAdapter } from './sandbox.js';
import { runPipeline } from './coordinator.js';
import { startChat } from './chat.js';

const args = process.argv.slice(2);
const cmd = args[0];
function opt(name, dflt) { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; }

async function main() {
  const cfg = loadConfig();
  if (!cfg.apiKey) { console.error('MODAL_PROXY_TOKEN is not set.'); process.exit(2); }
  if (cmd === 'build') {
    const task = args[1];
    const repo = opt('repo', process.cwd());
    if (!task) return usage(2);
    const store = new Store(cfg.dataDir);
    const runId = store.newRunId();
    console.log(`run ${runId} in ${repo}`);
    const rec = await runPipeline(
      { cfg, store, adapter: new LocalAdapter(store.sandboxesPath(runId)), emit: (t, d) => console.log(`[${t}]`, JSON.stringify(d)) },
      { task, sourceDir: repo, runId },
    );
    console.log(rec.status === 'verified' ? `VERIFIED ${rec.runId}` : `FAILED ${rec.runId} (${rec.error ?? 'see run.json'})`);
    process.exit(rec.status === 'verified' ? 0 : 1);
  }
  if (cmd === 'chat') {
    const repo = opt('repo', process.cwd());
    const mode = opt('mode', 'cheap');
    return startChat(cfg, { sourceDir: repo, mode });
  }
  if (cmd === 'validate') {
    const { runValidation } = await import('../../validation/runner.js').catch((err) => {
      if (err.code === 'ERR_MODULE_NOT_FOUND' && String(err.message).includes('validation/runner.js')) return { runValidation: null };
      throw err;
    });
    if (!runValidation) { console.error('validate: implemented in Task 16 (validation/runner.js missing).'); process.exit(2); }
    await runValidation(cfg, { onlyTask: opt('task', null), onlyArm: opt('arm', null) });
    return;
  }
  usage(2);
}

function usage(code) {
  console.error('usage: node src/cli.js build "<task>" --repo <path> | chat --repo <path> [--mode guided] | validate [--task id] [--arm A|B]');
  process.exit(code);
}
main();
