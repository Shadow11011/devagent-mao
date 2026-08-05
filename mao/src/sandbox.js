import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const execFileP = promisify(execFile);
const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };

async function git(args, cwd) {
  const { stdout } = await execFileP('git', ['-c', 'user.email=mao@local', '-c', 'user.name=mao', ...args], { cwd, env: GIT_ENV, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export async function cloneProject(src, dst) {
  await fsp.rm(dst, { recursive: true, force: true });
  if (fs.existsSync(path.join(src, '.git'))) await execFileP('git', ['clone', '-q', src, dst]);
  else await execFileP('cp', ['-a', src, dst]);
}

export class LocalAdapter {
  constructor(rootDir) {
    this.root = rootDir;
    this.meta = new Map(); // id -> { dir, missing }
    fs.mkdirSync(rootDir, { recursive: true });
  }

  async spawn({ id, sourceDir, files = [], homeConfig = null }) {
    const dir = path.join(this.root, id, 'work');
    const maoHome = path.join(this.root, id, 'home');
    await fsp.rm(path.join(this.root, id), { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    await fsp.mkdir(maoHome, { recursive: true });
    const missing = [];
    for (const rel of files) {
      const from = path.join(sourceDir, rel);
      const to = path.join(dir, rel);
      if (!fs.existsSync(from)) { missing.push(rel); continue; }
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(from, to);
    }
    await git(['init', '-q'], dir);
    await git(['add', '-A'], dir);
    await git(['commit', '-qm', 'baseline', '--allow-empty'], dir);
    if (homeConfig) await fsp.writeFile(path.join(maoHome, 'config.toml'), homeConfig);
    this.meta.set(id, { dir, missing });
    return { id, dir, maoHome };
  }

  missingFiles(id) { return this.meta.get(id)?.missing ?? []; }

  async exec(id, { cmd, timeoutMs, env = {} }) {
    const dir = this.meta.get(id)?.dir;
    if (!dir) throw new Error(`exec: unknown sandbox ${id}`);
    const ts = Date.now();
    const stdoutPath = path.join(this.root, id, `exec-${ts}.out.log`);
    const stderrPath = path.join(this.root, id, `exec-${ts}.err.log`);
    const outFd = fs.openSync(stdoutPath, 'w');
    const errFd = fs.openSync(stderrPath, 'w');
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn('bash', ['-c', cmd], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', outFd, errFd], detached: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
      }, timeoutMs);
      let settled = false;
      const closeFds = () => { if (settled) return; settled = true; clearTimeout(timer); fs.closeSync(outFd); fs.closeSync(errFd); };
      child.on('error', (err) => { // spawn failure: 'close' may still fire after this, so close fds exactly once
        closeFds();
        fs.appendFileSync(stderrPath, `spawn-error: ${err.message}\n`);
        resolve({ exitCode: 1, stdoutPath, stderrPath, durationMs: Date.now() - started, timedOut: false });
      });
      child.on('close', (code) => {
        closeFds();
        resolve({ exitCode: timedOut ? 124 : (code ?? 1), stdoutPath, stderrPath, durationMs: Date.now() - started, timedOut });
      });
    });
  }

  async diff(id) {
    const dir = this.meta.get(id)?.dir;
    if (!dir) throw new Error(`diff: unknown sandbox ${id}`);
    await git(['add', '-A'], dir);
    const nameStatus = await git(['diff', '--cached', '--name-status'], dir);
    const diff = await git(['diff', '--cached'], dir);
    const newFiles = [], editedFiles = [], deletedFiles = [];
    for (const line of nameStatus.split('\n').filter(Boolean)) {
      const [code, ...rest] = line.split('\t');
      const p = rest.join('\t');
      if (code.startsWith('A')) newFiles.push(p);
      else if (code.startsWith('D')) deletedFiles.push(p);
      else editedFiles.push(p);
    }
    return { newFiles, editedFiles, deletedFiles, diff };
  }

  readFile(id, rel) {
    const dir = this.meta.get(id)?.dir;
    if (!dir) throw new Error(`readFile: unknown sandbox ${id}`);
    const full = path.resolve(dir, rel);
    if (!full.startsWith(path.resolve(dir) + path.sep)) throw new Error(`path traversal blocked: ${rel}`);
    return fs.readFileSync(full, 'utf8');
  }

  async snapshot(id) {
    const dir = this.meta.get(id)?.dir;
    if (!dir) throw new Error(`snapshot: unknown sandbox ${id}`);
    await git(['add', '-A'], dir);
    await git(['commit', '-qm', `snapshot-${Date.now()}`, '--allow-empty'], dir);
    return git(['rev-parse', 'HEAD'], dir);
  }

  async restore(id, sha) {
    const dir = this.meta.get(id)?.dir;
    if (!dir) throw new Error(`restore: unknown sandbox ${id}`);
    await git(['reset', '--hard', '-q', sha], dir);
    await git(['clean', '-fdq'], dir);
  }

  async destroy(id) { this.meta.delete(id); }
}
