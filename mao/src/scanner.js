import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const IGNORE = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.next', 'coverage', '.mao', 'mao-home']);
const MAX_FILES = 400;
const MAX_SUMMARY_CHARS = 8000;

export function scanProject(dir) {
  const files = [];
  walk(dir, dir, files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const truncated = files.length > MAX_FILES;
  const listed = truncated ? files.slice(0, MAX_FILES) : files;

  const stack = detectStack(dir);
  const lines = [
    `Project: ${path.basename(dir)} (${files.length} files${truncated ? `, first ${MAX_FILES} listed` : ''})`,
    `Stack: ${stack}`,
    'Files:',
    ...listed.map((f) => `- ${f.path} (${f.bytes}b)`),
  ];
  let summary = lines.join('\n');
  if (summary.length > MAX_SUMMARY_CHARS) summary = summary.slice(0, MAX_SUMMARY_CHARS) + '\n…(truncated)';
  return { summary, files, truncated };
}

function walk(root, dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) walk(root, full, out);
    else if (entry.isFile()) {
      let bytes = 0;
      try { bytes = statSync(full).size; } catch { /* race-tolerant */ }
      out.push({ path: rel, bytes });
    }
  }
}

function detectStack(dir) {
  const parts = [];
  const pkgPath = path.join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      parts.push(`node package "${pkg.name ?? 'unnamed'}"; scripts=${JSON.stringify(pkg.scripts ?? {})}; deps=[${deps.slice(0, 12).join(', ')}${deps.length > 12 ? ',…' : ''}]`);
    } catch { parts.push('node (unreadable package.json)'); }
  }
  if (existsSync(path.join(dir, 'requirements.txt')) || existsSync(path.join(dir, 'pyproject.toml'))) parts.push('python');
  if (existsSync(path.join(dir, 'Cargo.toml'))) parts.push('rust');
  if (existsSync(path.join(dir, 'go.mod'))) parts.push('go');
  return parts.length ? parts.join(' | ') : 'unknown (no manifest detected)';
}
