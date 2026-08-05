import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalAdapter } from '../src/sandbox.js';

let root, src;
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mao-sbx-'));
  src = mkdtempSync(path.join(tmpdir(), 'mao-src-'));
  mkdirSync(path.join(src, 'src'), { recursive: true });
  writeFileSync(path.join(src, 'package.json'), '{"name":"x"}');
  writeFileSync(path.join(src, 'src', 'app.js'), 'console.log(1)\n');
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); });

describe('LocalAdapter', () => {
  it('spawn copies listed files only and baselines git', async () => {
    const a = new LocalAdapter(root);
    const s = await a.spawn({ id: 's1', sourceDir: src, files: ['src/app.js', 'nope.js'], homeConfig: '[provider]\nopenai_reasoning_effort = "low"\n' });
    expect(existsSync(path.join(s.dir, 'src', 'app.js'))).toBe(true);
    expect(existsSync(path.join(s.dir, 'package.json'))).toBe(false); // not requested
    expect(a.missingFiles('s1')).toEqual(['nope.js']);
    expect(readFileSync(path.join(s.maoHome, 'config.toml'), 'utf8')).toContain('openai_reasoning_effort');
  });

  it('exec runs commands and captures output; diff reports changes', async () => {
    const a = new LocalAdapter(root);
    const s = await a.spawn({ id: 's2', sourceDir: src, files: ['src/app.js'] });
    const r = await a.exec('s2', { cmd: 'echo "console.log(2)" >> src/app.js && echo "new" > src/new.js', timeoutMs: 10_000 });
    expect(r.exitCode).toBe(0);
    const d = await a.diff('s2');
    expect(d.newFiles).toEqual(['src/new.js']);
    expect(d.editedFiles).toEqual(['src/app.js']);
    expect(d.diff).toContain('+console.log(2)');
    expect(a.readFile('s2', 'src/new.js')).toBe('new\n');
  });

  it('exec timeout kills and reports', async () => {
    const a = new LocalAdapter(root);
    await a.spawn({ id: 's3', sourceDir: src, files: [] });
    const r = await a.exec('s3', { cmd: 'sleep 5', timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).toBe(124);
  });

  it('snapshot and restore round-trip', async () => {
    const a = new LocalAdapter(root);
    await a.spawn({ id: 's4', sourceDir: src, files: ['src/app.js'] });
    const sha = await a.snapshot('s4');
    await a.exec('s4', { cmd: 'echo broken > src/app.js', timeoutMs: 5000 });
    await a.restore('s4', sha);
    expect(a.readFile('s4', 'src/app.js')).toBe('console.log(1)\n');
  });
});
