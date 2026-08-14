import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOkf } from '../src/okf/index.js';
import { repoHash, slugify, parseFrontmatter, serializeDoc } from '../src/okf/store.js';

let root, okf;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mao-okf-'));
  okf = createOkf({ root });
});

function cleanup() { if (root) rmSync(root, { recursive: true, force: true }); }

describe('okf store', () => {
  it('repoHash is stable for a fixed source path and differs across dirs', () => {
    expect(repoHash('/a/b')).toBe(repoHash('/a/b'));
    expect(repoHash('/a/b')).not.toBe(repoHash('/a/c'));
  });

  it('slugify normalizes problem types', () => {
    expect(slugify('Auth Import Conflict')).toBe('auth-import-conflict');
    expect(slugify('  ..weird__ thing!!  ')).toBe('weird-thing');
  });

  it('parseFrontmatter splits meta and body', () => {
    const md = '---\ntype: solution\nfeature: auth\n---\n\nbody text';
    const { meta, body } = parseFrontmatter(md);
    expect(meta).toEqual({ type: 'solution', feature: 'auth' });
    expect(body.trim()).toBe('body text');
  });

  it('serializeDoc round-trips meta and body', () => {
    const md = serializeDoc({ meta: { type: 'solution', feature: 'auth' }, body: 'lesson' });
    const { meta, body } = parseFrontmatter(md);
    expect(meta.type).toBe('solution');
    expect(meta.feature).toBe('auth');
    expect(body.trim()).toBe('lesson');
  });

  it('record writes a project-scoped doc and is recallable', () => {
    const doc = okf.record({
      scope: 'project', repo: '/proj', problemType: 'auth-import-conflict',
      evidence: { attempted: 'split user model', worked: 'removed circular import', failed: 'naive re-export', lesson: 'break the cycle at the model layer' },
    });
    expect(doc.scope).toBe('project');
    expect(doc.problemType).toBe('auth-import-conflict');
    expect(existsSync(doc.path)).toBe(true);
    const hits = okf.recall.recall('circular import between user and session', { scope: 'project' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].doc.id).toBe(doc.id);
  });

  it('dedups near-identical docs (similarity > 0.9 updates, no duplicate)', () => {
    const evidence = { attempted: 'x', worked: 'y', failed: 'z', lesson: 'reusable lesson about auth import cycle' };
    const a = okf.record({ scope: 'project', repo: '/proj', problemType: 'auth', evidence });
    const b = okf.record({ scope: 'project', repo: '/proj', problemType: 'auth', evidence });
    expect(b.id).toBe(a.id);
    expect(okf.store.allDocs().length).toBe(1);
  });

  it('snapshots previous version on update, rollback restores it', () => {
    const d1 = okf.record({ scope: 'project', repo: '/proj', problemType: 'x', evidence: { attempted: 'first', worked: '', failed: '', lesson: 'v1' } });
    const d2 = okf.store.write('project', '/proj', 'x', { id: d1.id, meta: d1.meta, body: '# v2 body' });
    expect(d2.seq).toBe(1);
    const restored = okf.store.rollback(d1.id);
    expect(restored.body).toBe(d1.body);
    expect(restored.seq).toBe(d1.seq);
  });

  it('rollback throws when there are no snapshots', () => {
    const d = okf.record({ scope: 'project', repo: '/proj', problemType: 'x', evidence: { lesson: 'l' } });
    expect(() => okf.store.rollback(d.id)).toThrow(/no snapshots/);
  });
});

describe('okf recall (two-step)', () => {
  it('formatContext returns empty for no matches', () => {
    expect(okf.recallContext('totally novel thing')).toBe('');
  });

  it('formatContext includes doc body and scope', () => {
    okf.record({ scope: 'global', problemType: 'react-supabase', evidence: { lesson: 'use rls for authz' } });
    const ctx = okf.recallContext('how to secure supabase rows', { scope: 'global' });
    expect(ctx).toContain('react-supabase');
    expect(ctx).toContain('use rls for authz');
  });
});

describe('okf refine (evidence-backed)', () => {
  it('recordOutcome sets failure type when evidence.failed present', () => {
    const doc = okf.refine.recordOutcome({ scope: 'project', repo: '/p', problemType: 't', evidence: { attempted: 'a', failed: 'f', lesson: 'l' } });
    expect(doc.meta.type).toBe('failure');
  });

  it('recordOutcome sets solution type when nothing failed', () => {
    const doc = okf.refine.recordOutcome({ scope: 'project', repo: '/p', problemType: 't', evidence: { attempted: 'a', worked: 'w', lesson: 'l' } });
    expect(doc.meta.type).toBe('solution');
  });
});
