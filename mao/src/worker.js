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
  // Fast path: stdout IS one (possibly pretty-printed) JSON document.
  const whole = text.trim();
  if (whole.startsWith('{')) { try { return JSON.parse(whole); } catch { /* fall through */ } }
  // Noisy stdout: the report is the balanced JSON object ending at the end of output.
  // (Nested objects deeper inside also balance-parse, so position is the disambiguator.)
  const endPos = text.trimEnd().length;
  let fallback = null;
  for (const cand of balancedObjects(text)) {
    if (cand.end === endPos) {
      try { return JSON.parse(text.slice(cand.start, cand.end)); } catch { /* keep scanning */ }
    } else if (fallback === null) {
      try { fallback = JSON.parse(text.slice(cand.start, cand.end)); } catch { /* not json */ }
    }
  }
  if (fallback !== null) { console.error('[parseTrailingJson] warning: no terminal JSON object; using latest balanced fallback'); return fallback; }
  throw new Error('no JSON report found in worker stdout');
}

// Yields every balanced {...} span (string-aware), from LAST opening brace backward.
function* balancedObjects(text) {
  const opens = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '{') opens.push(i);
  for (let oi = opens.length - 1; oi >= 0; oi--) {
    const start = opens[oi];
    let depth = 0, inStr = false, esc = false;
    for (let j = start; j < text.length; j++) {
      const c = text[j];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { yield { start, end: j + 1 }; break; }
      }
    }
  }
}

export function extractSummary(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  return (last.startsWith('SUMMARY:') ? last.slice(8).trim() : last).slice(0, 300);
}

export async function runWorker(cfg, adapter, sandbox, {
  feature, lesson = '', okfContext = '', endpoint = cfg.models.worker, profile = cfg.workerProfiles.worker, timeoutMs = cfg.workerTimeoutMs,
}) {
  const taskMd = renderPrompt(loadPrompt('worker.v1'), {
    FEATURE_DESCRIPTION: feature.description,
    FILES_LIST: (feature.files ?? []).map((f) => `- ${f}`).join('\n') || '(none)',
    OKF_CONTEXT: okfContext ? `RELEVANT LESSONS FROM PRIOR BUILDS (use these, but judge if they apply to this slice):\n${okfContext}` : '',
    LESSON: lesson ? `LESSON FROM PREVIOUS FAILED ATTEMPT (do not repeat it):\n${lesson}` : '',
  });
  await fsp.writeFile(path.join(sandbox.dir, 'MAOWORK.md'), taskMd);
  // MAOWORK.md is orchestrator scaffolding, not feature output: keep it out of the git diff.
  const excludePath = path.join(sandbox.dir, '.git', 'info', 'exclude');
  const excludeBody = await fsp.readFile(excludePath, 'utf8').catch(() => '');
  if (!excludeBody.split('\n').includes('MAOWORK.md')) await fsp.appendFile(excludePath, 'MAOWORK.md\n');
  const cmd = `"${cfg.workerBin}" -C . --provider-profile ${profile} -m "${endpoint.model}" run --json 'Read MAOWORK.md in the current directory and do exactly what it says.'`;
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
  // Scope enforcement: workers may only CREATE feature.newFiles and EDIT feature.files.
  // Model obedience is not trusted — violations are reverted here so the judge sees a
  // contract-shaped diff (and integration owners like package.json can't be clobbered).
  const trimmed = await enforceScope(adapter, sandbox.id, feature);
  return { ok: true, failureCode: null, failureDetail: trimmed.length ? `out-of-scope changes reverted: ${trimmed.join(', ')}` : '', summary: extractSummary(report.text), text: report.text ?? '', usage: normU(report.usage), durationMs: r.durationMs, gateLog, trimmedFiles: trimmed };

async function enforceScope(adapter, id, feature) {
  const allowed = new Set([...(feature.files ?? []), ...(feature.newFiles ?? [])]);
  if (!allowed.size) return [];
  const d = await adapter.diff(id);
  const trimmed = [];
  for (const rel of d.newFiles) if (!allowed.has(rel)) { await adapter.exec(id, { cmd: `rm -f -- ${shq(rel)}`, timeoutMs: 10_000 }); trimmed.push(rel); }
  for (const rel of d.editedFiles) if (!allowed.has(rel)) { await adapter.exec(id, { cmd: `git checkout -- ${shq(rel)}`, timeoutMs: 10_000 }); trimmed.push(rel); }
  for (const rel of d.deletedFiles) if (!allowed.has(rel)) { await adapter.exec(id, { cmd: `git checkout -- ${shq(rel)}`, timeoutMs: 10_000 }); trimmed.push(rel); }
  return trimmed;
}

function shq(p) { return `'${String(p).replace(/'/g, `'\\''`)}'`; }
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
