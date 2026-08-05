import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../mao/src/config.js';
import { Store } from '../mao/src/store.js';
import { LocalAdapter } from '../mao/src/sandbox.js';
import { scanProject } from '../mao/src/scanner.js';
import { runWorker, workerHomeConfig } from '../mao/src/worker.js';
import { verifyCandidate } from '../mao/src/verifier.js';
import { runPipeline } from '../mao/src/coordinator.js';
import { TASKS } from './tasks.js';
import { renderResultsMd } from './report.js';

const VAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const RESULTS = path.join(VAL, 'results');
const REPO_ROOT = path.resolve(VAL, '..');

function baseDirFor(task) { return task.kind === 'fixture' ? path.join(VAL, 'fixtures', task.id === 't10' ? 't6' : task.id) : path.join(VAL, 'repos', task.id); }

export async function runValidation(cfg = loadConfig(), { onlyTask = null, onlyArm = null } = {}) {
  if (!cfg.apiKey) throw new Error('MODAL_PROXY_TOKEN is not set');
  fs.mkdirSync(RESULTS, { recursive: true });
  const tasks = TASKS.filter((t) => !onlyTask || t.id === onlyTask);
  for (const task of tasks) {
    for (const arm of ['A', 'B']) {
      if (onlyArm && arm !== onlyArm) continue;
      const outFile = path.join(RESULTS, `${task.id}-${arm}.json`);
      if (fs.existsSync(outFile)) { console.log(`skip ${task.id}-${arm} (done)`); continue; }
      console.log(`=== ${task.id} arm ${arm} start ===`);
      const metrics = await runArm(cfg, task, arm).catch((err) => ({ taskId: task.id, arm, status: 'error', verifyOk: false, error: String(err.message).slice(0, 500), planFeatureCount: 0, mergeNeeded: 0, couplingEscalations: 0, attemptsTotal: 0, usage: { orchestrator: { in: 0, out: 0 }, workers: { in: 0, out: 0 } }, gpuLatencyMs: 0, wallClockMs: 0 }));
      fs.writeFileSync(outFile, JSON.stringify(metrics, null, 2));
      console.log(`=== ${task.id} arm ${arm} -> ${metrics.status} ===`);
    }
  }
  const metrics = fs.readdirSync(RESULTS).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')));
  fs.writeFileSync(path.join(REPO_ROOT, 'VALIDATION-RESULTS.md'), renderResultsMd(metrics, new Date().toISOString()));
  console.log('VALIDATION-RESULTS.md updated from', metrics.length, 'arm records');
}

async function runArm(cfg, task, arm) {
  const sourceDir = baseDirFor(task);
  const store = new Store(path.join(cfg.dataDir, 'validation'));
  const runId = `val-${task.id}-${arm.toLowerCase()}-${Date.now().toString(36)}`;
  const verify = { commands: task.verifyCommands, hiddenTests: task.hiddenTests };
  const started = Date.now();
  if (arm === 'A') {
    const rec = await runPipeline(
      { cfg, store, adapter: new LocalAdapter(store.sandboxesPath(runId)), emit: (t, d) => console.log(`  [${t}]`, typeof d === 'object' ? JSON.stringify(d).slice(0, 160) : d) },
      { task: task.prompt, sourceDir, runId, verify, orchestratorEffort: task.orchestratorEffort ?? null },
    );
    return {
      taskId: task.id, arm, status: rec.status, verifyOk: rec.status === 'verified',
      planFeatureCount: rec.plan?.features.length ?? 0,
      mergeNeeded: Object.keys(rec.coupling ?? {}).length,
      couplingEscalations: Object.values(rec.coupling ?? {}).filter((c) => c.escalated).length,
      attemptsTotal: Object.values(rec.features ?? {}).reduce((s, f) => s + f.attempts, 0),
      usage: { orchestrator: toInOut(rec.totals.orchestrator), workers: toInOut(rec.totals.workers) },
      gpuLatencyMs: null, wallClockMs: Date.now() - started,
    };
  }
  // Arm B: single orchestrator-model worker over the FULL repo. No plan, no judge, no coupling — the baseline.
  const adapter = new LocalAdapter(store.sandboxesPath(runId));
  const scan = scanProject(sourceDir);
  const sb = await adapter.spawn({ id: runId, sourceDir, files: scan.files.map((f) => f.path), homeConfig: workerHomeConfig() });
  const w = await runWorker(cfg, adapter, sb, {
    feature: { id: 'whole-task', description: task.prompt, files: [], newFiles: [], dependencies: [] },
    endpoint: cfg.models.orchestrator, profile: cfg.workerProfiles.orchestrator, timeoutMs: cfg.runTimeoutMs,
  });
  const diffInfo = w.ok ? await adapter.diff(runId) : { newFiles: [], editedFiles: [] };
  const files = new Map();
  for (const rel of [...diffInfo.newFiles, ...diffInfo.editedFiles]) files.set(rel, adapter.readFile(runId, rel));
  const ver = await verifyCandidate(cfg, { runId, sourceDir, files, commands: verify.commands, hiddenTests: verify.hiddenTests });
  return {
    taskId: task.id, arm, status: ver.ok ? 'verified' : 'failed', verifyOk: ver.ok,
    planFeatureCount: 1, mergeNeeded: 0, couplingEscalations: 0, attemptsTotal: 1,
    usage: { orchestrator: { in: w.usage.input, out: w.usage.output }, workers: { in: 0, out: 0 } },
    gpuLatencyMs: null, wallClockMs: Date.now() - started,
  };
}

const toInOut = (t) => ({ in: t.input ?? 0, out: t.output ?? 0 });
