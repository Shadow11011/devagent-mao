// Phase E — OKF attempt-reduction measurement (the moat proof).
//
// The Aug 5 baseline was a NO-OKF run. To measure whether OKF recall reduces
// worker attempts, each targeted task is run TWICE against the SAME OKF store:
//   pass 1 = cold (OKF empty, lessons are generated on the way out)
//   pass 2 = warm (recalls pass 1's lessons)
// The moat metric is attemptDelta = coldAttempts - warmAttempts, per task and
// summed. Positive = OKF saved attempts. Zero/negative = OKF did not help.
//
// This is intentionally NOT wired into runner.runValidation (which hits every
// arm); it is a focused, opt-in harness you run explicitly.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../mao/src/config.js';
import { Store } from '../mao/src/store.js';
import { LocalAdapter } from '../mao/src/sandbox.js';
import { runPipeline } from '../mao/src/coordinator.js';
import { createOkf } from '../mao/src/okf/index.js';
import { TASKS } from './tasks.js';
import { runArm } from './runner.js';

const VAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const RESULTS = path.join(VAL, 'phaseE');

function attemptsOf(rec) {
  return Object.values(rec.features ?? {}).reduce((s, f) => s + (f.attempts ?? 0), 0);
}

export function attemptDelta({ coldAttempts, warmAttempts }) {
  return coldAttempts - warmAttempts;
}

export function summarizePhaseE(rows) {
  const cold = rows.reduce((s, r) => s + r.coldAttempts, 0);
  const warm = rows.reduce((s, r) => s + r.warmAttempts, 0);
  return { cold, warm, delta: cold - warm, tasks: rows.length };
}

export async function runPhaseE(cfg, { taskIds = ['t1', 't2', 't3', 't5', 't9'] } = {}) {
  if (!cfg.apiKey) throw new Error('MODAL_PROXY_TOKEN is not set');
  fs.mkdirSync(RESULTS, { recursive: true });
  const tasks = TASKS.filter((t) => taskIds.includes(t.id));
  const rows = [];

  for (const task of tasks) {
    // Shared OKF store so warm recall sees cold lessons for the SAME repo.
    const okf = createOkf({ root: path.join(cfg.dataDir, 'phaseE', 'okf', task.id) });
    const repoId = okf.store.repoHash(path.join(VAL, 'fixtures', task.id === 't10' ? 't6' : task.id));

    const runOne = async (label) => {
      const store = new Store(path.join(cfg.dataDir, 'phaseE', task.id, label));
      const runId = `phe-${task.id}-${label}-${Date.now().toString(36)}`;
      const rec = await runPipeline(
        { cfg, store, adapter: new LocalAdapter(store.sandboxesPath(runId)), emit: (t, d) => console.log(`  [${task.id}/${label}] ${t} ${JSON.stringify(d).slice(0, 140)}`), okf },
        { task: task.prompt, sourceDir: path.join(VAL, 'fixtures', task.id === 't10' ? 't6' : task.id), runId, verify: { commands: task.verifyCommands, hiddenTests: task.hiddenTests }, orchestratorEffort: task.orchestratorEffort ?? null, preinstall: true },
      );
      return { status: rec.status, attempts: attemptsOf(rec), rec };
    };

    const cold = await runOne('cold');
    const warm = await runOne('warm');
    const row = {
      taskId: task.id,
      coldAttempts: cold.attempts,
      coldStatus: cold.status,
      warmAttempts: warm.attempts,
      warmStatus: warm.status,
      delta: attemptDelta({ coldAttempts: cold.attempts, warmAttempts: warm.attempts }),
    };
    rows.push(row);
    fs.writeFileSync(path.join(RESULTS, `${task.id}.json`), JSON.stringify(row, null, 2));
    console.log(`=== ${task.id}: cold ${cold.attempts} attempts (${cold.status}) -> warm ${warm.attempts} attempts (${warm.status}) -> delta ${row.delta} ===`);
  }

  const summary = summarizePhaseE(rows);
  const md = renderPhaseE(rows, summary, new Date().toISOString());
  fs.writeFileSync(path.join(VAL, 'PHASE-E-RESULTS.md'), md);
  return { rows, summary };
}

function renderPhaseE(rows, s, generatedAt) {
  const body = rows.map((r) => `| ${r.taskId} | ${r.coldAttempts} (${r.coldStatus}) | ${r.warmAttempts} (${r.warmStatus}) | ${r.delta} |`).join('\n');
  return `# PHASE-E-RESULTS — OKF attempt-reduction (the moat proof)

> Generated: ${generatedAt}. Two-pass cold/warm per task, same OKF store, same fixture, same hidden tests. Baseline (Aug 5, no OKF) attempts are listed for comparison where known.

| Task | Cold attempts | Warm attempts | Attempt delta (cold - warm) |
|------|--------------|--------------|-----------------------------|
${body}

## Summary

- Tasks: **${s.tasks}**
- Cold attempts total: **${s.cold}**
- Warm attempts total: **${s.warm}**
- Attempt delta (cold - warm): **${s.delta}**

Positive delta = OKF recall reduced worker attempts (the moat). Zero or negative = no measured reduction on this sample.
`;
}
