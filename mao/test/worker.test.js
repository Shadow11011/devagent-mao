import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseTrailingJson, extractSummary, runWorker, workerHomeConfig } from '../src/worker.js';
import { LocalAdapter } from '../src/sandbox.js';
import { loadConfig } from '../src/config.js';

describe('parseTrailingJson', () => {
  it('parses report after noise', () => {
    const out = 'some text\n{"session_id":"s","text":"done","usage":{"input_tokens":3,"output_tokens":2}}\n';
    expect(parseTrailingJson(out).usage.input_tokens).toBe(3);
  });
  it('throws when no json', () => expect(() => parseTrailingJson('nada')).toThrow(/no JSON/i));
});

describe('extractSummary', () => {
  it('takes last SUMMARY line', () => {
    expect(extractSummary('blah\nSUMMARY: built util.js\n')).toBe('built util.js');
    expect(extractSummary('only text')).toBe('only text');
  });
});

describe('workerHomeConfig', () => {
  it('contains both profiles', () => {
    const t = workerHomeConfig();
    expect(t).toContain('[providers.inkling]');
    expect(t).toContain('[providers.kimi-k3]');
    expect(t).toContain('api_key_env = "MODAL_PROXY_TOKEN"');
  });
});

describe('runWorker with fake binary', () => {
  let root, src, fakeBin;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'mao-wrk-'));
    src = path.join(root, 'src'); mkdirSync(src, { recursive: true });
    fakeBin = path.join(root, 'fake-mao');
    writeFileSync(fakeBin, '#!/bin/bash\necho "console.log(1)" > out.js\necho text before\nprintf \'{"session_id":"s","provider":"p","model":"m","text":"did it\\\\nSUMMARY: wrote out.js","usage":{"input_tokens":11,"output_tokens":7}}\\n\'\n');
    chmodSync(fakeBin, 0o755);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('runs binary, parses report, captures diff', async () => {
    const cfg = loadConfig({ workerBin: fakeBin, dataDir: path.join(root, 'data') });
    const adapter = new LocalAdapter(path.join(root, 'sbx'));
    const sb = await adapter.spawn({ id: 'w1', sourceDir: src, files: [], homeConfig: workerHomeConfig() });
    const r = await runWorker(cfg, adapter, sb, { feature: { id: 'f1', description: 'make out.js', files: [], newFiles: ['out.js'], dependencies: [] } });
    expect(r.ok).toBe(true);
    expect(r.usage).toEqual({ input: 11, output: 7 });
    expect(r.summary).toBe('wrote out.js');
    expect((await adapter.diff('w1')).newFiles).toEqual(['out.js']);
  });
});
