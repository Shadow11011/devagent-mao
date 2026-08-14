// OKF store: portable markdown + YAML frontmatter, git-optional local files.
//
// Layout (relative to dataDir/okf):
//   project/<repo-hash>/<problem_type>/<id>.md
//   global/<problem_type>/<id>.md
//   snapshots/<id>/<seq>.md
//   index.jsonl
//
// Scope is part of every doc: project-scoped lessons are the moat; global-scoped
// lessons are commodity (MOAT.md). The store never mutates an existing doc in
// place without first writing a snapshot.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cosine } from './embed.js';

export function repoHash(sourceDir) {
  // A stable, cheap identity for the project so project-scoped lessons follow
  // the repo even across renames/moves. Prefer the git remote when available;
  // otherwise hash the absolute path so two distinct dirs don't share a bucket.
  const gitConfig = path.join(sourceDir, '.git', 'config');
  try {
    const cfg = fs.readFileSync(gitConfig, 'utf8');
    const url = cfg.match(/url\s*=\s*(\S+)/)?.[1];
    if (url) return crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
  } catch { /* no .git */ }
  return crypto.createHash('sha1').update(path.resolve(sourceDir)).digest('hex').slice(0, 12);
}

export function slugify(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'doc';
}

export function parseFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(md ?? ''));
  if (!m) return { meta: {}, body: String(md ?? '').trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const eq = line.indexOf(':');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key) meta[key] = val;
  }
  return { meta, body: String(md ?? '').slice(m[0].length).trimStart() };
}

export function serializeDoc(doc) {
  const meta = { ...doc.meta };
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) lines.push(`${k}: ${String(v)}`);
  lines.push('---', '', String(doc.body ?? '').trimEnd(), '');
  return lines.join('\n');
}

export function createOkfStore({ root, embedFn, now = () => new Date().toISOString() }) {
  const dirs = {
    project: path.join(root, 'project'),
    global: path.join(root, 'global'),
    snapshots: path.join(root, 'snapshots'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const indexPath = path.join(root, 'index.jsonl');

  function docPath(scope, repo, problemType, id) {
    return scope === 'project'
      ? path.join(dirs.project, repo, slugify(problemType), `${id}.md`)
      : path.join(dirs.global, slugify(problemType), `${id}.md`);
  }

  function loadIndex() {
    if (!fs.existsSync(indexPath)) return [];
    return fs.readFileSync(indexPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  }

  function writeIndex(entries) {
    fs.writeFileSync(indexPath, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  }

  function snapshot(doc, seq) {
    const dir = path.join(dirs.snapshots, doc.id);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${seq}.md`);
    fs.writeFileSync(p, serializeDoc(doc), 'utf8');
    return p;
  }

  function readDoc(ref) {
    const md = fs.readFileSync(ref.path, 'utf8');
    const { meta, body } = parseFrontmatter(md);
    return {
      id: ref.id,
      scope: ref.scope,
      repo: ref.repo ?? null,
      problemType: ref.problemType,
      path: ref.path,
      seq: ref.seq ?? 0,
      updated_at: ref.updated_at ?? meta.updated_at ?? null,
      meta,
      body,
      text: serializeDoc({ meta, body }),
    };
  }

  function allDocs() {
    return loadIndex().map(readDoc);
  }

  function findBySimilarity(text, threshold = 0.9) {
    const target = embedFn(text);
    let best = null;
    for (const doc of allDocs()) {
      // Compare body-to-body, not against the full serialized doc: frontmatter
      // (scope/repo/timestamps) is metadata noise that would depress the score.
      const sim = cosine(embedFn(doc.body), target);
      if (sim >= threshold && (!best || sim > best.sim)) best = { doc, sim };
    }
    return best;
  }

  function write(scope, repo, problemType, doc) {
    const id = doc.id ?? `${slugify(problemType)}-${Date.now().toString(36)}`;
    const existing = loadIndex().find((e) => e.id === id);
    const seq = existing ? (existing.seq ?? 0) + 1 : 0;
    const nowIso = now();
    const meta = {
      scope,
      problem_type: slugify(problemType),
      ...(scope === 'project' ? { repo: repo ?? '' } : {}),
      created_at: existing ? (doc.meta?.created_at ?? existing.created_at ?? nowIso) : (doc.meta?.created_at ?? nowIso),
      updated_at: nowIso,
      ...(doc.meta ?? {}),
    };
    const full = { id, meta, body: doc.body };
    const ref = { id, path: docPath(scope, repo, problemType, id), scope, repo: scope === 'project' ? (repo ?? null) : null, problemType: slugify(problemType), seq, updated_at: meta.updated_at };

    // Snapshot the PREVIOUS version (from disk) before we overwrite it, so
    // rollback can restore the exact prior body + meta. The snapshot carries the
    // seq of the version being replaced (existing.seq), not the incoming seq.
    if (existing) {
      const prevMd = fs.existsSync(ref.path) ? fs.readFileSync(ref.path, 'utf8') : '';
      const prev = parseFrontmatter(prevMd);
      const prevDoc = { id, meta: prev.meta, body: prev.body };
      snapshot(prevDoc, existing.seq ?? 0);
    }

    fs.mkdirSync(path.dirname(ref.path), { recursive: true });
    fs.writeFileSync(ref.path, serializeDoc(full), 'utf8');

    const index = loadIndex().filter((e) => e.id !== id);
    const entry = { id, path: ref.path, scope, repo: ref.repo, problemType: ref.problemType, seq, created_at: meta.created_at, updated_at: meta.updated_at };
    writeIndex([...index, entry]);

    return readDoc(entry);
  }

  function record({ scope, repo, problemType, body, meta = {} }) {
    // Dedup before write: similarity > 0.9 -> update the existing doc, never
    // create a duplicate (PROMPTS.md okf-writer). Project-scoped dedup must also
    // match the repo so one codebase's lesson never overwrites another's.
    const near = findBySimilarity(body, 0.9);
    if (near && near.doc.scope === scope && (scope !== 'project' || near.doc.repo === repo)) {
      return write(scope, near.doc.repo ?? repo, problemType, {
        id: near.doc.id,
        meta: { ...near.doc.meta, ...meta },
        body: mergeBodies(near.doc.body, body),
      });
    }
    return write(scope, repo, problemType, { meta, body });
  }

  function rollback(id) {
    const ref = loadIndex().find((e) => e.id === id);
    if (!ref) throw new Error(`unknown okf doc: ${id}`);
    const snapDir = path.join(dirs.snapshots, id);
    if (!fs.existsSync(snapDir)) throw new Error(`no snapshots for okf doc: ${id}`);
    const snaps = fs.readdirSync(snapDir).map((f) => ({ name: f, seq: Number(f.replace('.md', '')) })).sort((a, b) => a.seq - b.seq);
    if (!snaps.length) throw new Error(`no snapshots for okf doc: ${id}`);
    const prev = snaps[snaps.length - 1];
    const md = fs.readFileSync(path.join(snapDir, prev.name), 'utf8');
    const { meta, body } = parseFrontmatter(md);
    fs.writeFileSync(ref.path, serializeDoc({ id, meta, body }), 'utf8');
    // Restore the index to the snapshot's version and drop the rolled-forward snapshot.
    const index = loadIndex().filter((e) => e.id !== id);
    writeIndex([...index, { ...ref, seq: prev.seq, updated_at: meta.updated_at ?? ref.updated_at }]);
    fs.rmSync(path.join(snapDir, prev.name), { force: true });
    return readDoc({ ...ref, seq: prev.seq });
  }

  return {
    dirs,
    indexPath,
    repoHash,
    allDocs,
    findBySimilarity,
    write,
    record,
    rollback,
    loadIndex,
  };
}

function mergeBodies(existing, incoming) {
  // Small, evidence-backed merge. Keep the existing reusable lesson and append
  // the new evidence as a dated entry; never discard what was already learned.
  const existingClean = String(existing ?? '').trim();
  const incomingClean = String(incoming ?? '').trim();
  if (!existingClean) return incomingClean;
  if (!incomingClean) return existingClean;
  return `${existingClean}\n\n## Update\n\n${incomingClean}`;
}
