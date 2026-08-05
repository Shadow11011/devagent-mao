import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanProject } from '../src/scanner.js';

let dir;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mao-scan-'));
  mkdirSync(path.join(dir, 'src', 'routes'), { recursive: true });
  mkdirSync(path.join(dir, 'node_modules', 'junk'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { express: '^4.0.0' }, scripts: { test: 'node --test' } }));
  writeFileSync(path.join(dir, 'src', 'app.js'), 'x');
  writeFileSync(path.join(dir, 'src', 'routes', 'a.js'), 'x');
  writeFileSync(path.join(dir, 'node_modules', 'junk', 'b.js'), 'x');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('scanProject', () => {
  it('lists files excluding junk dirs', () => {
    const r = scanProject(dir);
    const paths = r.files.map((f) => f.path).sort();
    expect(paths).toEqual(['package.json', 'src/app.js', 'src/routes/a.js']);
    expect(r.truncated).toBe(false);
  });
  it('summary mentions stack and files', () => {
    const r = scanProject(dir);
    expect(r.summary).toContain('express');
    expect(r.summary).toContain('src/routes/a.js');
    expect(r.summary.length).toBeLessThan(9000);
  });
});
