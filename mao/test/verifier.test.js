import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultVerifyCommands, verifyCandidate } from '../src/verifier.js';
import { loadConfig } from '../src/config.js';

let root;
beforeAll(() => { root = mkdtempSync(path.join(tmpdir(), 'mao-vfy-')); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('defaultVerifyCommands', () => {
  it('builds sensible node commands', () => {
    const c = defaultVerifyCommands({ hasPackageJson: true, packageJsonChanged: true, changedJs: ['a.js'] });
    expect(c.some((x) => x.includes('npm install'))).toBe(true);
    expect(c.some((x) => x.includes('npm run --if-present build'))).toBe(true);
    expect(c).toContain('node --check "a.js"');
  });
  it('emits one quoted node --check per changed js file', () => {
    expect(defaultVerifyCommands({ hasPackageJson: false, packageJsonChanged: false, changedJs: ['a.js', 'dir/b.js'] }))
      .toEqual(['node --check "a.js"', 'node --check "dir/b.js"']);
  });
});

describe('verifyCandidate', () => {
  it('returns ok=true when commands pass, applies candidate files', async () => {
    const src = path.join(root, 'src1'); mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, 'index.js'), 'console.log(1)\n');
    const cfg = loadConfig({ dataDir: path.join(root, 'data') });
    const files = new Map([['added.js', 'console.log(2)\n']]);
    const r = await verifyCandidate(cfg, { runId: 't1', sourceDir: src, files, commands: ['node --check index.js && node --check added.js'] });
    expect(r.ok).toBe(true);
    expect(r.log).toContain('node --check');
  });
  it('returns ok=false with log when a command fails', async () => {
    const src = path.join(root, 'src2'); mkdirSync(src, { recursive: true });
    const cfg = loadConfig({ dataDir: path.join(root, 'data') });
    const r = await verifyCandidate(cfg, { runId: 't2', sourceDir: src, files: new Map(), commands: ['false'] });
    expect(r.ok).toBe(false);
    expect(r.log).toMatch(/exit 1/i);
  });
  it('hiddenTests are written into stage', async () => {
    const src = path.join(root, 'src3'); mkdirSync(src, { recursive: true });
    const cfg = loadConfig({ dataDir: path.join(root, 'data') });
    const r = await verifyCandidate(cfg, { runId: 't3', sourceDir: src, files: new Map(), commands: ['test -f hidden/h.test.js'], hiddenTests: [{ path: 'hidden/h.test.js', content: '// t' }] });
    expect(r.ok).toBe(true);
  });
});
