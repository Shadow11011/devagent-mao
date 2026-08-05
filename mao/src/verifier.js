import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { chatJson } from './modelClient.js';
import { loadPrompt, renderPrompt } from './prompts.js';
import { cloneProject } from './sandbox.js';

export function defaultVerifyCommands({ hasPackageJson, packageJsonChanged, changedJs }) {
  const cmds = [];
  if (hasPackageJson && packageJsonChanged) cmds.push('npm install --no-audit --no-fund --loglevel=error');
  if (hasPackageJson) cmds.push('npm run --if-present build', 'npm run --if-present test');
  for (const f of changedJs) cmds.push(`node --check "${f}"`);
  return cmds;
}

export async function verifyCandidate(cfg, { runId, sourceDir, files, commands, hiddenTests = [] }) {
  const stagePath = path.join(cfg.dataDir, 'verify', String(runId));
  await fsp.mkdir(path.dirname(stagePath), { recursive: true }); // cp -a in cloneProject needs the parent to exist
  await cloneProject(sourceDir, stagePath);
  for (const [rel, content] of files) {
    const full = path.join(stagePath, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content);
  }
  for (const h of hiddenTests) {
    const full = path.join(stagePath, h.path);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, h.content);
  }
  const log = [];
  let ok = true;
  for (const cmd of commands) {
    const r = await runCmd(stagePath, cmd);
    log.push(`$ ${cmd}\n${r.output}`);
    if (r.exitCode !== 0) { ok = false; log.push(`!! command failed with exit ${r.exitCode}: ${cmd}`); break; }
  }
  return { ok, stagePath, log: log.join('\n\n') };
}

function runCmd(cwd, cmd, timeoutMs = 10 * 60_000) {
  return new Promise((resolve) => {
    const child = spawn('bash', ['-lc', cmd], { cwd, env: { ...process.env, CI: 'true' } });
    let out = '';
    const cap = (d) => { out += d.toString(); if (out.length > 200_000) out = out.slice(-200_000); };
    child.stdout.on('data', cap); child.stderr.on('data', cap);
    const t = setTimeout(() => { child.kill('SIGKILL'); out += '\n(TIMEOUT)'; }, timeoutMs);
    child.on('close', (code) => { clearTimeout(t); resolve({ exitCode: code ?? 1, output: out.trim() }); });
  });
}

export const VERIFYFIX_SCHEMA = {
  type: 'object',
  properties: {
    fixes: { type: ['array', 'null'], items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false } },
    unfixable: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['unfixable', 'reason'],
  additionalProperties: false,
};

export async function requestVerifyFix(cfg, { log, filesSummary }) {
  const system = renderPrompt(loadPrompt('verifier-fix.v1'), { LOG_TAIL: String(log).slice(-20_000) });
  const r = await chatJson(cfg.models.orchestrator, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: `Candidate files:\n${filesSummary}` }],
    jsonFormat: { type: 'json_schema', json_schema: { name: 'verifier_fix', strict: true, schema: VERIFYFIX_SCHEMA } },
    validate: (o) => { if (!o.unfixable && (!Array.isArray(o.fixes) || !o.fixes.length)) throw new Error('fixes required unless unfixable'); return o; },
    reasoningEffort: 'high',
    apiKey: cfg.apiKey, timeoutMs: cfg.requestTimeoutMs,
  });
  return { fixes: r.value.unfixable ? null : r.value.fixes, unfixable: r.value.unfixable, reason: r.value.reason, usage: r.usage };
}
