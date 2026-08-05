import fsp from 'node:fs/promises';
import path from 'node:path';
import { loadPrompt, renderPrompt } from './prompts.js';

export function workerHomeConfig() {
  return `[provider]
openai_reasoning_effort = "low"

[providers.inkling]
type = "openai-compatible"
base_url = "https://oluwafemifrancisca27--ep-inkling-nvfp4-server.us-west.modal.direct/v1"
api_key_env = "MODAL_PROXY_TOKEN"
default_model = "thinkingmachines/Inkling-NVFP4"

[providers.kimi-k3]
type = "openai-compatible"
base_url = "https://oluwafemifrancisca27--ep-kimi-k3-server.us-west.modal.direct/v1"
api_key_env = "MODAL_PROXY_TOKEN"
default_model = "moonshotai/Kimi-K3"
`;
}

export function parseTrailingJson(stdout) {
  const text = String(stdout ?? '');
  let i = text.lastIndexOf('{"');
  while (i >= 0) {
    const cand = text.slice(i).trim();
    const close = cand.lastIndexOf('}');
    for (const t of (close > 0 ? [cand, cand.slice(0, close + 1)] : [cand])) {
      try { return JSON.parse(t); } catch { /* keep scanning */ }
    }
    i = text.lastIndexOf('{"', Math.max(0, i - 1));
  }
  throw new Error('no JSON report found in worker stdout');
}

export function extractSummary(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  return (last.startsWith('SUMMARY:') ? last.slice(8).trim() : last).slice(0, 300);
}

export async function runWorker(cfg, adapter, sandbox, {
  feature,lesson = '', endpoint = cfg.models.worker, profile = cfg.workerProfiles.worker, timeoutMs = cfg.workerTimeoutMs,
}) {
  const taskMd = renderPrompt(loadPrompt('worker.v1'), {
    FEATURE_DESCRIPTION: feature.description,
    FILES_LIST: (feature.files ?? []).map((f) => `- ${f}`).join('\n') || '(none)',
    LESSON: lesson ? `LESSON FROM PREVIOUS FAILED ATTEMPT (do not repeat it):\n${lesson}` : '',
  });
  await fsp.writeFile(path.join(sandbox.dir, 'MAOWORK.md'), taskMd);
  // MAOWORK.md is orchestrator scaffolding, not feature output: keep it out of the git diff.
  await fsp.appendFile(path.join(sandbox.dir, '.git', 'info', 'exclude'), 'MAOWORK.md\n');
  const cmd = `"${cfg.workerBin}" -C . --provider-profile ${profile} -m "${endpoint.model}" run --json 'Read MAOWORK.md in the current directory and do exactly what it says.'`;
  const started = Date.now();
  const r = await adapter.exec(sandbox.id, {
    cmd, timeoutMs,
    env: { MAO_HOME: sandbox.maoHome, MAO_RUN_MCP: '0', MODAL_PROXY_TOKEN: cfg.apiKey },
  });
  if (r.timedOut) return { ok: false, failureCode: 'TIMEOUT', failureDetail: `exceeded ${timeoutMs}ms`, summary: '', text: '', usage: { input: 0, output: 0 }, durationMs: r.durationMs, gateLog: '' };
  const stdout = await fsp.readFile(r.stdoutPath, 'utf8');
  let report;
  try { report = parseTrailingJson(stdout); }
  catch (err) {
    const stderrTail = (await fsp.readFile(r.stderrPath, 'utf8')).slice(-1500);
    return { ok: false, failureCode: r.exitCode !== 0 ? 'EXEC_FAIL' : 'REPORT_MISSING', failureDetail: `${err.message}; exit=${r.exitCode}; stderr tail: ${stderrTail}`, summary: '', text: '', usage: { input: 0, output: 0 }, durationMs: r.durationMs, gateLog: '' };
  }
  if (r.exitCode !== 0) {
    const stderrTail = (await fsp.readFile(r.stderrPath, 'utf8')).slice(-1500);
    return { ok: false, failureCode: 'EXEC_FAIL', failureDetail: `exit=${r.exitCode}; stderr tail: ${stderrTail}`, summary: '', text: report.text ?? '', usage: normU(report.usage), durationMs: r.durationMs, gateLog: '' };
  }
  const gateLog = await qualityGate(adapter, sandbox.id);
  return { ok: true, failureCode: null, failureDetail: '', summary: extractSummary(report.text), text: report.text ?? '', usage: normU(report.usage), durationMs: Date.now() - started, gateLog };
}

function normU(u = {}) { return { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0 }; }

async function qualityGate(adapter, id) {
  const d = await adapter.diff(id);
  const jsFiles = [...d.newFiles, ...d.editedFiles].filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  if (!jsFiles.length) return '(no changed .js files; gate skipped)';
  const checks = jsFiles.map((f) => `node --check "${f}"`).join(' && ');
  const r = await adapter.exec(id, { cmd: checks, timeoutMs: 60_000 });
  return `node --check over ${jsFiles.length} file(s): exit=${r.exitCode}`;
}
