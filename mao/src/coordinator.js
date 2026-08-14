import fs from 'node:fs';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { scanProject } from './scanner.js';
import * as realApi from './api.js';
import { createOkf } from './okf/index.js';
import { discoverSkills, formatSkillsForPrompt } from './skills.js';
import { recursivePlan, decomposeFeatureWithOrchestrator } from './recursive.js';

export async function runPipeline(deps, opts) {
  const { cfg, store, adapter, okf: injectedOkf } = deps;
  const api = { ...realApi, ...(deps.api ?? {}) };
  const emit = (type, data = {}) => { store.appendEvent(opts.runId, { type, data }); deps.emit?.(type, data); };
  const started = Date.now();
  const totals = { orchestrator: { input: 0, output: 0 }, workers: { input: 0, output: 0 } };
  const addU = (bucket, u) => { bucket.input += u.input ?? u.prompt ?? 0; bucket.output += u.output ?? u.completion ?? 0; };
  const rec = { runId: opts.runId, task: opts.task, sourceDir: opts.sourceDir, status: 'failed', plan: null, features: {}, coupling: {}, verification: null, totals, createdAt: new Date().toISOString() };

  // OKF memory (Continual Harness). Injectable via deps.okf for tests; default
  // creates one under cfg.dataDir/okf. Opt-out via MAO_OKF=0 so the zero-dep and
  // byte-for-byte default path both stay testable.
  const okf = injectedOkf ?? (process.env.MAO_OKF === '0' ? null : createOkf({ root: path.join(cfg.dataDir, 'okf') }));
  const repoId = okf ? okf.store.repoHash(opts.sourceDir) : null;

  // Skills (capability layer). Discovered once per build from project + user
  // locations; injected as a rendered block into each worker's prompt. Disable
  // with MAO_SKILLS=0 or override via deps.skillsContext (tests).
  const skillsContext = deps.skillsContext ?? (process.env.MAO_SKILLS === '0'
    ? ''
    : formatSkillsForPrompt(discoverSkills({ cwd: opts.sourceDir }).skills));

  // scan + plan
  const scan = scanProject(opts.sourceDir);
  emit('scan', { files: scan.files.length, truncated: scan.truncated });
  const okfContext = okf ? okf.recallContext(opts.task, { scope: 'project', repo: repoId }) : '';
  let planOut;
  try { planOut = await api.planBuild(cfg, { summary: scan.summary, okfContext, prompt: opts.task, effort: opts.orchestratorEffort }); }
  catch (err) { rec.status = 'plan-failed'; rec.error = err.message; emit('plan-failed', { error: err.message }); return finish(); }
  let plan = planOut.plan;
  addU(totals.orchestrator, planOut.usage);

  // Recursive mode (gated off by default): when enabled, decompose any coarse
  // feature into ordered leaves before waves/couple/verify run. Off => this block
  // is skipped and the flat pipeline is byte-for-byte unchanged.
  if (cfg.recursive) {
    const decomposeFeature = deps.decomposeFeature ?? decomposeFeatureWithOrchestrator(cfg);
    const recursiveOut = await recursivePlan(plan, {
      decomposeFeature,
      maxDepth: cfg.recursiveMaxDepth,
    });
    rec.plan = recursiveOut; // store the decomposed plan on the run record
    rec.recursive = { enabled: true, maxDepth: cfg.recursiveMaxDepth, featuresBefore: plan.features.length, featuresAfter: recursiveOut.features.length };
    plan = recursiveOut;
    emit('recursive-plan', { features: plan.features.map((f) => f.id), waves: plan.waves });
  } else {
    rec.plan = plan;
  }

  emit('plan', { features: plan.features.map((f) => f.id), waves: plan.waves });

  // materialized working copy that waves build upon
  const baseDir = store.materializedPath(opts.runId);
  await api.cloneProject(opts.sourceDir, baseDir);

  const outputs = {}; // featureId -> Map(rel->content)
  const workerEndpoint = opts.workerEndpoint ?? cfg.models.worker;
  const workerProfile = opts.workerProfile ?? cfg.workerProfiles.worker;
  for (let wi = 0; wi < plan.waves.length; wi++) {
    const wave = plan.waves[wi];
    emit('wave-start', { wave: wi, features: wave });
    await mapLimit(wave, cfg.concurrency, async (fid) => {
      const feature = plan.features.find((f) => f.id === fid);
      const result = await buildFeature(api, deps, opts, feature, rec, emit, totals, baseDir, wi, workerEndpoint, workerProfile, okf, repoId, skillsContext);
      if (result) outputs[fid] = result;
    });
    emit('wave-done', { wave: wi, ok: wave.filter((f) => outputs[f]).length, total: wave.length });
    // Materialize this wave's passing outputs into baseDir so later waves spawn with them mounted.
    // Same-wave file collisions stay last-write-wins here (wave's feature-id order); the
    // authoritative candidate is still assembled via coupleFile below — coupling is untouched.
    for (const fid of wave) {
      const out = outputs[fid];
      if (!out) continue;
      for (const [rel, content] of out) {
        const full = path.join(baseDir, rel);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, content);
      }
    }
  }

  // Status semantics: feature-level failure IS run-level failure. If ANY feature exhausted its
  // attempts with no passing output, the partial candidate would trivially pass verification —
  // fail the run instead, and skip verification (and K3 fix calls) entirely.
  const exhaustedIds = plan.features.filter((f) => !outputs[f.id] || rec.features[f.id]?.exhausted).map((f) => f.id);
  if (exhaustedIds.length) {
    rec.status = 'failed';
    rec.verification = { ok: false, log: `features exhausted: ${exhaustedIds.join(', ')}`, fixesApplied: 0, commands: [] };
    rec.failedFeatures = exhaustedIds;
    emit('failed', { reason: 'features-exhausted', features: exhaustedIds });
    return finish();
  }

  // coupling + materialize into baseDir (then verify from a CLEAN clone of source + candidate files)
  const candidate = new Map(); // rel -> content
  const byFile = groupByFile(plan, outputs);
  for (const [rel, variants] of byFile) {
    if (!variants.length) continue;
    let content;
    if (variants.length === 1) content = variants[0].content;
    else {
      const original = await readMaybe(opts.sourceDir, rel);
      const c = await api.coupleFile(cfg, { path: rel, original, variants: variants.map((v) => ({ featureId: v.featureId, intent: v.intent, content: v.content })) });
      addU(totals.orchestrator, c.usage);
      rec.coupling[rel] = { variants: variants.length, escalated: c.escalated, conflicts: c.conflicts };
      emit('couple', { path: rel, variants: variants.length, escalated: c.escalated, conflicts: c.conflicts.length });
      content = c.content;
    }
    candidate.set(rel, content);
  }

  // No feature exhausted, but nothing was produced (e.g. all diffs empty): an empty candidate
  // vacuously passes verification — that is a failed run, never a verified one.
  if (!candidate.size) {
    rec.status = 'failed';
    rec.verification = { ok: false, log: 'empty candidate: no produced files', fixesApplied: 0, commands: [] };
    rec.failedFeatures = [];
    emit('failed', { reason: 'empty-candidate' });
    return finish();
  }

  // verification with fix loop
  const verify = opts.verify ?? {};
  const changedJs = [...candidate.keys()].filter((f) => f.endsWith('.js'));
  const commands = verify.commands ?? api.defaultVerifyCommands({ hasPackageJson: hasPkg(opts.sourceDir), packageJsonChanged: candidate.has('package.json'), changedJs });
  let ver = await api.verifyCandidate(cfg, { runId: opts.runId, sourceDir: opts.sourceDir, files: candidate, commands, hiddenTests: verify.hiddenTests ?? [] });
  let fixesApplied = 0;
  while (!ver.ok && fixesApplied < cfg.maxVerifyFixes) {
    const fix = await api.requestVerifyFix(cfg, { log: ver.log, filesSummary: [...candidate.keys()].join('\n') });
    addU(totals.orchestrator, fix.usage);
    if (fix.unfixable || !fix.fixes) break;
    for (const f of fix.fixes) candidate.set(f.path, f.content);
    fixesApplied++;
    emit('verify-fix', { round: fixesApplied, files: fix.fixes.map((f) => f.path) });
    ver = await api.verifyCandidate(cfg, { runId: `${opts.runId}-fix${fixesApplied}`, sourceDir: opts.sourceDir, files: candidate, commands, hiddenTests: verify.hiddenTests ?? [] });
  }
  rec.verification = { ok: ver.ok, log: ver.log.slice(-20_000), fixesApplied, commands };
  rec.status = ver.ok ? 'verified' : 'failed';
  emit(ver.ok ? 'verified' : 'failed', { fixesApplied });
  return finish();

  function finish() {
    rec.totals.wallClockMs = Date.now() - started;
    store.writeJson(`${store.runPath(rec.runId)}/run.json`, rec);
    recordOkf(okf, opts, rec, repoId);
    return rec;
  }

  function recordOkf(okf, opts, rec, repoId) {
    if (!okf) return;
    // Canonical OKF write on success AND failure (HARNESS-SPEC: no exceptions).
    // One doc per feature captures the intermediate judge lessons, which are what
    // warm recall uses to cut future attempts. The whole-run doc is secondary.
    const featureDocs = Object.entries(rec.features ?? {}).map(([fid, f]) => {
      const lessons = (f.judgeReasons ?? [])
        .filter((r) => r.lesson)
        .map((r) => r.lesson);
      const problemType = fid;
      const failed = (f.verdicts ?? []).some((v) => v === 'fail');
      const evidence = {
        attempted: `Feature: ${fid}`,
        worked: failed ? '' : `Verified feature: ${fid}`,
        failed: failed ? `Attempts: ${f.attempts}; verdicts: ${(f.verdicts ?? []).join(',')}` : '',
        lesson: lessons.join('\n') || (failed ? `Feature ${fid} failed after ${f.attempts} attempts` : `Verified feature ${fid}`),
        stack: scan?.stack,
        model: cfg.models.orchestrator.model,
      };
      return { scope: 'project', repo: repoId, problemType, evidence };
    });

    const failed = rec.status !== 'verified';
    const runDoc = {
      scope: 'project',
      repo: repoId,
      problemType: rec.plan?.features?.[0]?.id ? `build-${rec.plan.features[0].id}` : 'build',
      evidence: {
        attempted: `Build task: ${opts.task}`,
        worked: failed ? '' : `Features verified: ${rec.plan?.features?.map((f) => f.id).join(', ') ?? ''}`,
        failed: failed ? (rec.failedFeatures?.length ? `Exhausted features: ${rec.failedFeatures.join(', ')}` : (rec.error ?? 'verification failed')) : '',
        lesson: failed ? firstFailureLesson(rec) : `Verified build for: ${opts.task}`,
        stack: scan?.stack,
        model: cfg.models.orchestrator.model,
      },
    };

    try {
      for (const doc of featureDocs) okf.record(doc);
      okf.record(runDoc);
      rec.okf = { recorded: true, features: featureDocs.length, run: true };
    } catch (err) {
      // Memory failure must never fail the build.
      rec.okf = { recorded: false, error: err.message };
      emit('okf-error', { error: err.message });
    }
  }

  function firstFailureLesson(rec) {
    for (const f of Object.values(rec.features ?? {})) {
      const reason = f.judgeReasons?.find((r) => r.lesson);
      if (reason?.lesson) return reason.lesson;
    }
    return rec.error ?? 'build failed';
  }
}

async function buildFeature(api, deps, opts, feature, rec, emit, totals, baseDir, waveIndex = null, workerEndpoint = null, workerProfile = null, okf = null, repoId = null, skillsContext = '') {
  const { cfg, adapter } = deps;
  // OKF recall is stable across attempts (pre-prompt retrieval). The retry
  // `lesson` is a separate, attempt-scoped signal from the judge.
  const okfContext = okf ? okf.recallContext(feature.description, { scope: 'project', repo: repoId }) : '';
  let lesson = '';
  let freeRetryUsed = false; // exactly ONE free infra retry per feature, whenever TIMEOUT lands
  for (let attempt = 1; attempt <= cfg.maxWorkerAttempts; attempt++) {
    const sid = `${opts.runId}-${feature.id}-a${attempt}`;
    emit('worker-start', { feature: feature.id, attempt });
    const sb = await adapter.spawn({ id: sid, sourceDir: baseDir, files: feature.files, homeConfig: api.workerHomeConfig() });
    // Give workers a runnable env when asked (validation arms): the sandbox mounts files, not their deps.
    if (opts.preinstall && hasPkg(baseDir)) {
      const pre = await adapter.exec(sid, { cmd: 'npm install --no-audit --no-fund --loglevel=error', timeoutMs: 300_000 });
      emit('preinstall', { feature: feature.id, attempt, exitCode: pre.exitCode });
    }
    const w = await api.runWorker(cfg, adapter, sb, { feature, lesson, okfContext, skillsContext, endpoint: workerEndpoint, profile: workerProfile });
    totals.workers.input += w.usage.input; totals.workers.output += w.usage.output;
    if (!w.ok) {
      const infra = w.failureCode === 'TIMEOUT';
      emit('worker-error', { feature: feature.id, attempt, code: w.failureCode, detail: w.failureDetail.slice(0, 400), infra });
      if (infra && !freeRetryUsed) { freeRetryUsed = true; lesson = ''; attempt--; continue; } // one free infra retry
      lesson = `${w.failureCode}: ${w.failureDetail}`;
      continue;
    }
    const diffInfo = await adapter.diff(sid);
    emit('worker-done', { feature: feature.id, attempt, new: diffInfo.newFiles.length, edited: diffInfo.editedFiles.length, tokens: w.usage });
    const j = await api.judgeFeature(cfg, { feature, diffInfo, gateLog: w.gateLog, summary: w.summary });
    totals.orchestrator.input += j.usage.prompt; totals.orchestrator.output += j.usage.completion;
    rec.features[feature.id] = {
      attempts: attempt,
      verdicts: [...(rec.features[feature.id]?.verdicts ?? []), j.verdict],
      judgeReasons: [...(rec.features[feature.id]?.judgeReasons ?? []), { verdict: j.verdict, failureClass: j.failureClass ?? null, reason: j.reason ?? '', lesson: j.lesson ?? null, attempt }],
      summary: w.summary,
      usage: w.usage,
      wave: waveIndex,
    };
    if (j.verdict === 'pass') { emit('worker-judged', { feature: feature.id, attempt, verdict: 'pass' }); return collectOutputs(adapter, sid, diffInfo, feature); }
    lesson = j.lesson ?? j.reason;
    emit('worker-judged', { feature: feature.id, attempt, verdict: 'fail', class: j.failureClass });
  }
  rec.features[feature.id] = { ...(rec.features[feature.id] ?? { verdicts: [] }), attempts: cfg.maxWorkerAttempts, exhausted: true, wave: waveIndex };
  return null;
}

async function collectOutputs(adapter, sid, diffInfo, feature) {
  const m = new Map();
  for (const rel of [...diffInfo.newFiles, ...diffInfo.editedFiles]) m.set(rel, adapter.readFile(sid, rel));
  m.intent = feature.description;
  m.featureId = feature.id;
  return m;
}

function groupByFile(plan, outputs) {
  const byFile = new Map();
  for (const [fid, files] of Object.entries(outputs)) {
    if (!files) continue;
    for (const [rel, content] of files) {
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push({ featureId: fid, intent: files.intent, content });
    }
  }
  // deterministic order: earlier-wave feature first within each file
  const order = new Map(plan.waves.flat().map((id, i) => [id, i]));
  for (const arr of byFile.values()) arr.sort((a, b) => order.get(a.featureId) - order.get(b.featureId));
  return byFile;
}

async function readMaybe(dir, rel) {
  try { return await readFile(path.join(dir, rel), 'utf8'); } catch { return ''; }
}
function hasPkg(dir) { return fs.existsSync(path.join(dir, 'package.json')); }

async function mapLimit(items, n, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()); });
  await Promise.all(workers);
}
