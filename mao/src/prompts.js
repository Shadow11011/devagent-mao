import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'prompts');
const cache = new Map();

export function loadPrompt(name) {
  if (!cache.has(name)) cache.set(name, readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf8'));
  return cache.get(name);
}

export function renderPrompt(template, vars) {
  const missing = [];
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => {
    if (vars[key] === undefined) { missing.push(key); return m; }
    return String(vars[key]);
  });
  if (missing.length) throw new Error(`Missing prompt vars: ${missing.join(', ')}`);
  return out;
}
