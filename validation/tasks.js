// Mirrors /root/devagent-mao/VALIDATION.md task table. Contracts are explicit so both arms build to the same bar.
// Adaptations from the doc (recorded for the report): t3 React→framework-free TS components (no jsdom infra);
// t10 "BYOK Fable 5" → same fixture as t6 with orchestratorEffort 'high'.

const expressAppJs = (extra = '') => `const express = require('express');
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.json({ ok: true }));
${extra}
if (require.main === module) app.listen(3000);
module.exports = app;
`;

const pkgExpress = JSON.stringify({ name: 'val-app', private: true, scripts: {}, dependencies: { express: '4.21.2' } }, null, 2);

const hiddenServerTest = ({ requires, cases }) => `const test = require('node:test');
const assert = require('node:assert/strict');
const app = require(${JSON.stringify(requires)});

async function withServer(t, fn) {
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  const base = \`http://127.0.0.1:\${srv.address().port}\`;
  try { await fn(base); } finally { srv.close(); }
}

${cases}
`;

export const TASKS = [
  {
    id: 't1', title: 'Express auth module (JWT + bcrypt + middleware)', kind: 'fixture',
    fixture: { files: { 'package.json': pkgExpress, 'src/app.js': expressAppJs() } },
    prompt: `Add a complete auth module to this Express app: POST /auth/register {email,password} hashes with bcrypt and returns 201 {token}; POST /auth/login returns 200 {token} for valid credentials, 401 otherwise; JWT middleware protecting GET /profile returning 200 {email} with a valid Bearer token, 401 without. Keep module.exports = app and the require.main===module listen guard. Add required dependencies to package.json.`,
    verifyCommands: ['npm install --no-audit --no-fund --loglevel=error', 'node --test "hidden/*.test.js"'],
    hiddenTests: [{ path: 'hidden/auth.test.js', content: hiddenServerTest({
      requires: '../src/app.js',
      cases: `test('register, login, protected profile', async () => {
  await withServer(null, async (base) => {
    const reg = await fetch(base + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'pw12345' }) });
    assert.equal(reg.status, 201);
    const { token } = await reg.json();
    assert.ok(token);
    const bad = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'wrong' }) });
    assert.equal(bad.status, 401);
    const noTok = await fetch(base + '/profile');
    assert.equal(noTok.status, 401);
    const ok = await fetch(base + '/profile', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).email, 'a@b.c');
  });
});`,
    }) }],
  },
  {
    id: 't2', title: 'REST CRUD API (3 resources, shared router)', kind: 'fixture',
    fixture: { files: { 'package.json': pkgExpress, 'src/app.js': expressAppJs() } },
    prompt: `Add CRUD for three resources — products, orders, customers — each with: GET /<res> (list), GET /<res>/:id, POST /<res> (create with id), DELETE /<res>/:id. In-memory storage is fine. Share a single router factory to avoid duplication. Keep module.exports = app and the require.main===module guard.`,
    verifyCommands: ['npm install --no-audit --no-fund --loglevel=error', 'node --test "hidden/*.test.js"'],
    hiddenTests: [{ path: 'hidden/crud.test.js', content: hiddenServerTest({
      requires: '../src/app.js',
      cases: `test('crud on all three resources', async () => {
  await withServer(null, async (base) => {
    for (const res of ['products', 'orders', 'customers']) {
      const created = await (await fetch(base + '/' + res, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) })).json();
      assert.ok(created.id !== undefined, res + ' create returns id');
      const got = await fetch(base + '/' + res + '/' + created.id);
      assert.equal(got.status, 200, res + ' get');
      const list = await (await fetch(base + '/' + res)).json();
      assert.ok(Array.isArray(list));
      const del = await fetch(base + '/' + res + '/' + created.id, { method: 'DELETE' });
      assert.ok([200, 204].includes(del.status));
    }
  });
});`,
    }) }],
  },
  {
    id: 't3', title: 'Component set (form + list + detail, shared state) — TS adaptation', kind: 'fixture',
    fixture: { files: {
      'package.json': JSON.stringify({ name: 'ui-lib', private: true, scripts: { build: 'tsc -p .' }, devDependencies: { typescript: '5.6.3' } }, null, 2),
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'commonjs', outDir: 'dist', rootDir: 'src', strict: true, skipLibCheck: true, declaration: true }, include: ['src'] }, null, 2),
      'src/state.ts': `export type Item = { id: string; label: string };\nexport class Store {\n  private items: Item[] = [];\n  add(label: string): Item { const it = { id: String(this.items.length + 1), label }; this.items.push(it); return it; }\n  all(): Item[] { return [...this.items]; }\n  find(id: string): Item | undefined { return this.items.find((i) => i.id === id); }\n}\n`,
    } },
    prompt: `Build a framework-free TypeScript component set: src/components/form.ts (a FormComponent class with render(): string producing an HTML form with a text input and submit, and onSubmit(handler: (label: string) => void)), src/components/list.ts (ListComponent rendering <ul> of store items), src/components/detail.ts (DetailComponent rendering one item's full view). All three share the Store from src/state.ts. npm run build must stay green under strict tsc.`,
    verifyCommands: ['npm install --no-audit --no-fund --loglevel=error', 'npm run build', 'node --test "hidden/*.test.js"'],
    hiddenTests: [{ path: 'hidden/components.test.js', content: `const test = require('node:test');\nconst assert = require('node:assert/strict');\ntest('components exist and share store', async () => {\n  const { Store } = require('../dist/state.js');\n  const store = new Store();\n  store.add('alpha');\n  const { ListComponent } = require('../dist/components/list.js');\n  const html = new ListComponent(store).render();\n  assert.ok(html.includes('alpha'));\n  const { FormComponent } = require('../dist/components/form.js');\n  const form = new FormComponent();\n  let got = null;\n  form.onSubmit((label) => { got = label; });\n  assert.equal(typeof form.render(), 'string');\n  assert.ok(form.render().includes('<form'));\n  const { DetailComponent } = require('../dist/components/detail.js');\n  assert.ok(new DetailComponent(store).render('1').includes('alpha'));\n});\n` }],
  },
  {
    id: 't4', title: 'CLI tool (3 subcommands, shared main + config)', kind: 'fixture',
    fixture: { files: {
      'package.json': JSON.stringify({ name: 'strtool', private: true, bin: { strtool: './bin.js' } }, null, 2),
      'bin.js': `#!/usr/bin/env node\nconst [, , cmd, ...rest] = process.argv;\nif (!cmd) { console.error('usage: strtool <cmd> [args]'); process.exit(1); }\nrequire('./src/main').run(cmd, rest);\n`,
      'src/main.js': `exports.run = (cmd, args) => { console.error('unknown cmd: ' + cmd); process.exit(1); };\n`,
      'config.json': '{ "version": 1 }\n',
    } },
    prompt: `Implement three subcommands sharing src/main.js and reading config.json: "upper <text...>" prints args joined and uppercased; "reverse <text...>" prints reversed; "sum <numbers...>" prints their sum (error exit 2 on non-numeric). Keep bin.js unchanged.`,
    verifyCommands: ['node --test "hidden/*.test.js"'],
    hiddenTests: [{ path: 'hidden/cli.test.js', content: `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { execFileSync } = require('node:child_process');\nconst run = (args) => execFileSync('node', ['bin.js', ...args], { cwd: __dirname + '/..', encoding: 'utf8' }).trim();\ntest('subcommands', () => {\n  assert.equal(run(['upper', 'hello', 'world']), 'HELLO WORLD');\n  assert.equal(run(['reverse', 'abc']), 'cba');\n  assert.equal(run(['sum', '2', '3.5']), '5.5');\n  assert.throws(() => run(['sum', 'x']));\n});\n` }],
  },
  {
    id: 't5', title: 'Data pipeline (fetch → transform → store, staged)', kind: 'fixture',
    fixture: { files: {
      'package.json': JSON.stringify({ name: 'pipe', private: true }, null, 2),
      'src/fetch.js': `// stage 1: read raw input\n`, 'src/transform.js': `// stage 2: transform rows\n`, 'src/store.js': `// stage 3: persist\n`,
      'index.js': `// orchestrates stages\nrequire('./src/fetch'); require('./src/transform'); require('./src/store');\n`,
      'data/input.csv': 'name,score\nada,9\ngrace,7\nlinus,8\n',
    } },
    prompt: `Implement the pipeline so running "node index.js" reads data/input.csv via src/fetch.js, transforms rows to [{name, tier}] where tier = score>=8 ? "high" : "mid" via src/transform.js, and writes data/out.json (pretty-printed array) via src/store.js. Stages must stay in their own modules; index.js only orchestrates. No network access; input is the local CSV.`,
    verifyCommands: ['node --test "hidden/*.test.js"'],
    hiddenTests: [{ path: 'hidden/pipe.test.js', content: `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { execFileSync } = require('node:child_process');\nconst fs = require('node:fs');\ntest('pipeline produces out.json with tiers', () => {\n  const cwd = __dirname + '/..';\n  fs.rmSync(cwd + '/data/out.json', { force: true });\n  execFileSync('node', ['index.js'], { cwd });\n  const out = JSON.parse(fs.readFileSync(cwd + '/data/out.json', 'utf8'));\n  assert.deepEqual(out, [{ name: 'ada', tier: 'high' }, { name: 'grace', tier: 'mid' }, { name: 'linus', tier: 'high' }]);\n});\n` }],
  },
  {
    id: 't6', title: 'Auth + dashboard + payments (canonical 3-feature build)', kind: 'fixture',
    fixture: { files: { 'package.json': pkgExpress, 'src/app.js': expressAppJs() } },
    prompt: `Add three features to this Express app. (1) auth: POST /auth/register {email,password} (bcrypt hash) → 201 {token}; POST /auth/login → 200 {token}; JWT middleware. (2) dashboard: GET /dashboard (auth-required) → 200 {email, widgets: ["stats","recent"]}; 401 without token. (3) payments: POST /payments/charge {amountCents} (auth-required) → 200 {status: "stub", amountCents}; 401 without token. Add deps to package.json. Keep module.exports = app and the require.main===module guard.`,
    verifyCommands: ['npm install --no-audit --no-fund --loglevel=error', 'node --test "hidden/*.test.js"'],
    hiddenTests: [{ path: 'hidden/e2e.test.js', content: hiddenServerTest({
      requires: '../src/app.js',
      cases: `test('canonical build: auth, dashboard, payments', async () => {
  await withServer(null, async (base) => {
    const reg = await fetch(base + '/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@y.z', password: 'pw12345' }) });
    assert.equal(reg.status, 201);
    const { token } = await reg.json();
    const dash401 = await fetch(base + '/dashboard');
    assert.equal(dash401.status, 401);
    const dash = await fetch(base + '/dashboard', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(dash.status, 200);
    const pay = await fetch(base + '/payments/charge', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ amountCents: 500 }) });
    assert.equal(pay.status, 200);
    assert.equal((await pay.json()).status, 'stub');
  });
});`,
    }) }],
  },
  {
    id: 't7', title: 'Feature in existing real repo (express, 500+ files)', kind: 'clone',
    repoUrl: 'https://github.com/expressjs/express.git', ref: '4.21.2',
    prompt: `In this real Express repo: add a res.jsonApi(version, data) response helper in lib/response.js that sends {version, data} with application/json content-type, and add a unit test test/res.jsonApi.js in the repo's own test style (they use supertest + mocha; DO NOT run the full suite). Only touch lib/response.js and add the new test file.`,
    verifyCommands: ['npm install --no-audit --no-fund --loglevel=error', 'node --test "hidden/*.test.js"'],
    hiddenTests: [{ path: 'hidden/jsonapi.test.js', content: `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst express = require('../index.js');\ntest('res.jsonApi helper exists and works', async () => {\n  const app = express();\n  app.get('/x', (req, res) => { assert.equal(typeof res.jsonApi, 'function'); res.jsonApi('1.0', { a: 1 }); });\n  const srv = app.listen(0);\n  try {\n    await new Promise((r) => srv.once('listening', r));\n    const base = 'http://127.0.0.1:' + srv.address().port;\n    const r = await fetch(base + '/x');\n    const body = await r.json();\n    assert.deepEqual(body, { version: '1.0', data: { a: 1 } });\n  } finally { srv.close(); }\n});\n` }],
  },
  {
    id: 't8', title: 'Bugfix across 3 coupled files', kind: 'fixture',
    fixture: { files: {
      'package.json': JSON.stringify({ name: 'canonlib', private: true, scripts: { test: 'node --test' } }, null, 2),
      'src/canon.js': `// canonicalizes a record key. BUG: does not lowercase.\nexports.canon = (k) => k.trim();\n`,
      'src/api.js': `const { canon } = require('./canon');\nexports.getUser = (db, name) => db[canon(name)] ?? null;\n`,
      'src/format.js': `const { canon } = require('./canon');\nexports.show = (name) => 'user:' + canon(name);\n`,
      'test/canon.test.js': `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { canon } = require('../src/canon');\nconst { getUser } = require('../src/api');\nconst { show } = require('../src/format');\ntest('canon lowercases and trims', () => { assert.equal(canon('  Ada '), 'ada'); });\ntest('api finds user case-insensitively', () => { assert.deepEqual(getUser({ ada: 1 }, ' ADA '), 1); });\ntest('format shows canonical', () => { assert.equal(show(' ADA '), 'user:ada'); });\n`,
    } },
    prompt: `npm test fails: src/canon.js does not lowercase keys, breaking src/api.js lookups and src/format.js output. Fix the bug in canonicalization (keep trimming), keeping all three files consistent and all existing tests passing.`,
    verifyCommands: ['npm test', 'node --test "hidden/*.test.js"'],
    hiddenTests: [{ path: 'hidden/extra.test.js', content: `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { canon } = require('../src/canon');\ntest('canon idempotent on already-canonical input', () => { assert.equal(canon('ada'), 'ada'); });\ntest('canon handles inner spaces', () => { assert.equal(canon('  A D '), 'a d'); });\n` }],
  },
  {
    id: 't9', title: 'Feature with test requirement (npm test must pass)', kind: 'fixture',
    fixture: { files: {
      'package.json': JSON.stringify({ name: 'mathlib', private: true, scripts: { test: 'node --test' } }, null, 2),
      'src/math.js': `// math helpers live here\nmodule.exports = {};\n`,
      'test/.gitkeep': '',
    } },
    prompt: `Implement clamp(x, lo, hi), lerp(a, b, t), and roundTo(x, decimals) in src/math.js AND write your own tests for them in test/ covering edges (clamp above/below, lerp t=0/t=1, negative decimals rounding). npm test must pass.`,
    verifyCommands: ['npm test', 'node --test "hidden/*.test.js"'],
    hiddenTests: [{ path: 'hidden/math.test.js', content: `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst m = require('../src/math');\ntest('hidden math checks', () => {\n  assert.equal(m.clamp(5, 1, 3), 3);\n  assert.equal(m.clamp(-2, 1, 3), 1);\n  assert.equal(m.lerp(10, 20, 0.5), 15);\n  assert.equal(m.roundTo(1.2345, 2), 1.23);\n  assert.equal(m.roundTo(2.675, 2), 2.68);\n});\n` }],
  },
  {
    id: 't10', title: 'Canonical build with high-effort orchestrator (Fable-5 arm adaptation)', kind: 'fixture',
    orchestratorEffort: 'high',
    fixture: null, // filled below from t6
    prompt: '',
  },
];

// t10 inherits t6's fixture + prompt + verify + hidden tests; only the orchestrator effort changes.
{
  const t6 = TASKS.find((t) => t.id === 't6');
  const t10 = TASKS.find((t) => t.id === 't10');
  t10.fixture = t6.fixture;
  t10.prompt = t6.prompt;
  t10.verifyCommands = t6.verifyCommands;
  t10.hiddenTests = t6.hiddenTests;
}
