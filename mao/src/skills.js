// Skills: self-contained capability packages (Agent Skills standard) bridged to
// jcode workers.
//
// Discovery matches the Agent Skills spec:
//   - a directory containing SKILL.md is a skill root
//   - `pyproject.toml` in that directory marks a Python-backed skill
//   - import name = skill name with hyphens -> underscores
//   - src/<import_name>/__init__.py must exist for Python skills
//
// Locations (MAO project-local + user-global; Prime Agent's full location set is
// intentionally NOT adopted):
//   - <cwd>/.mao/skills/  and ancestors
//   - ~/.agents/skills/
//
// jcode workers run bash, not a Python kernel. A Python-backed skill that declares
// a console script in pyproject.toml is invoked as `!<import_name> --args` from
// the worker's shell; the orchestrator, if it needs the same skill, uses the
// Phase A bridge (Prime Agent kernel). This module only owns discovery + the
// contract; it never executes the script itself.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
const SKILL_FILE = 'SKILL.md';

export function parseFrontmatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(String(md ?? ''));
  if (!m) return { frontmatter: {}, body: String(md ?? '') };
  const frontmatter = {};
  for (const line of m[1].split('\n')) {
    const eq = line.indexOf(':');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (key) frontmatter[key] = val;
  }
  return { frontmatter, body: String(md ?? '').slice(m[0].length).trimStart() };
}

export function validateSkill({ name, description, dirName }) {
  const errors = [];
  if (name !== dirName) errors.push(`name "${name}" does not match directory "${dirName}"`);
  if (name.length > MAX_NAME_LENGTH) errors.push(`name exceeds ${MAX_NAME_LENGTH} characters`);
  if (!/^[a-z0-9-]+$/.test(name)) errors.push('name must be lowercase a-z, 0-9, hyphens only');
  if (name.startsWith('-') || name.endsWith('-')) errors.push('name must not start or end with a hyphen');
  if (name.includes('--')) errors.push('name must not contain consecutive hyphens');
  if (!description || !String(description).trim()) errors.push('description is required');
  else if (String(description).length > MAX_DESCRIPTION_LENGTH) errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
  return errors;
}

export function pythonImportName(name) {
  return name.replaceAll('-', '_');
}

export function isValidPythonImportName(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function detectPythonSkill(skillDir, name, diagnostics = []) {
  const pyprojectPath = path.join(skillDir, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) return null;
  const importName = pythonImportName(name);
  if (!isValidPythonImportName(importName)) {
    diagnostics.push({ type: 'warning', message: `python import name "${importName}" is invalid`, path: pyprojectPath });
    return null;
  }
  const initPath = path.join(skillDir, 'src', importName, '__init__.py');
  if (!fs.existsSync(initPath)) {
    diagnostics.push({ type: 'warning', message: `python package src/${importName}/__init__.py not found`, path: pyprojectPath });
    return null;
  }
  return { importName, packagePath: skillDir, pyprojectPath };
}

function loadSkillFromFile(filePath, source) {
  const diagnostics = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    const skillDir = path.dirname(filePath);
    const dirName = path.basename(skillDir);
    const name = frontmatter.name || dirName;
    const description = frontmatter.description;
    const errors = validateSkill({ name, description, dirName });
    for (const e of errors) diagnostics.push({ type: 'warning', message: e, path: filePath });

    // Only a missing description drops the skill entirely (spec: lenient on everything else).
    if (!description || !String(description).trim()) return { skill: null, diagnostics };

    const base = {
      name,
      description: String(description).trim(),
      filePath,
      baseDir: skillDir,
      source,
      body,
      disableModelInvocation: frontmatter['disable-model-invocation'] === true || frontmatter['disable-model-invocation'] === 'true',
    };

    // Python detection only applies to a SKILL.md in a skill directory (not a bare .md root file).
    const python = path.basename(filePath) === SKILL_FILE ? detectPythonSkill(skillDir, name, diagnostics) : null;
    return {
      skill: python ? { ...base, kind: 'python', python } : { ...base, kind: 'markdown' },
      diagnostics,
    };
  } catch (err) {
    diagnostics.push({ type: 'warning', message: err.message, path: filePath });
    return { skill: null, diagnostics };
  }
}

function scanDir(dir, source, { includeRootFiles = false } = {}) {
  const skills = [];
  const diagnostics = [];
  if (!fs.existsSync(dir)) return { skills, diagnostics };

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return { skills, diagnostics }; }

  // A directory with SKILL.md is a skill root; do not recurse past it.
  if (entries.some((e) => e.name === SKILL_FILE && e.isFile())) {
    const result = loadSkillFromFile(path.join(dir, SKILL_FILE), source);
    if (result.skill) skills.push(result.skill);
    diagnostics.push(...result.diagnostics);
    return { skills, diagnostics };
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try { const st = fs.statSync(full); isDir = st.isDirectory(); isFile = st.isFile(); } catch { continue; }
    }
    if (isDir) {
      const sub = scanDir(full, source);
      skills.push(...sub.skills);
      diagnostics.push(...sub.diagnostics);
    } else if (isFile && includeRootFiles && entry.name.endsWith('.md')) {
      const result = loadSkillFromFile(full, source);
      if (result.skill) skills.push(result.skill);
      diagnostics.push(...result.diagnostics);
    }
  }
  return { skills, diagnostics };
}

export function discoverSkills({ cwd = process.cwd(), home = os.homedir(), extraPaths = [] } = {}) {
  const skillMap = new Map();
  const diagnostics = [];
  const add = (result) => {
    diagnostics.push(...result.diagnostics);
    for (const skill of result.skills) {
      const existing = skillMap.get(skill.name);
      if (existing) {
        diagnostics.push({ type: 'collision', message: `skill name "${skill.name}" collision; keeping ${existing.filePath}`, path: skill.filePath });
      } else {
        skillMap.set(skill.name, skill);
      }
    }
  };

  // Project-local skills in cwd and ancestors (.mao/skills and .agents/skills).
  let dir = path.resolve(cwd);
  const projectRoots = [];
  while (true) {
    projectRoots.push(path.join(dir, '.mao', 'skills'));
    projectRoots.push(path.join(dir, '.agents', 'skills'));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const p of projectRoots) add(scanDir(p, 'project'));

  // User-global skills. Per spec, root .md files are ignored here; only
  // directories containing SKILL.md count.
  add(scanDir(path.join(home, '.agents', 'skills'), 'user'));

  for (const p of extraPaths) add(scanDir(p, 'path', { includeRootFiles: true }));

  return { skills: Array.from(skillMap.values()), diagnostics };
}

export function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// XML per the Agent Skills integrate-skills spec. Hidden (disable-model-invocation)
// skills are excluded; they can only be invoked explicitly.
export function formatSkillsForPrompt(skills) {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (!visible.length) return '';
  const lines = [
    '',
    'The following skills provide specialized instructions for specific tasks.',
    'Load a skill by reading its SKILL.md when the task matches its description.',
    'A python_import skill is a Python-backed capability; jcode workers call it from the shell as `!<python_import> <args>`.',
    '',
    '<available_skills>',
  ];
  for (const s of visible) {
    lines.push('  <skill>');
    lines.push(`    <name>${escapeXml(s.name)}</name>`);
    lines.push(`    <type>${s.kind}</type>`);
    if (s.kind === 'python') lines.push(`    <python_import>${escapeXml(s.python.importName)}</python_import>`);
    lines.push(`    <description>${escapeXml(s.description)}</description>`);
    lines.push(`    <location>${escapeXml(s.filePath)}</location>`);
    lines.push('  </skill>');
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

// Progressive disclosure: return the full content for one skill by name.
export function getSkill(skills, name) {
  return skills.find((s) => s.name === name) ?? null;
}

// The shell command a jcode worker uses to invoke a Python-backed skill. jcode
// workers use `!<cmd>` shell mode; the actual command is the console script name
// (which must equal the import name per the spec).
export function skillCommand(skill, args = '') {
  if (skill?.kind !== 'python') throw new Error(`skill "${skill?.name}" is not Python-backed`);
  const bin = skill.python.importName;
  return args ? `${bin} ${args}` : bin;
}

// Install hint for the worker: a Python skill must be on PATH (installed console
// script) or invocable via its package. This returns the non-executing contract.
export function skillInstallHint(skill) {
  if (skill?.kind !== 'python') return '';
  return `cd "${skill.baseDir}" && pip install -e .`;
}
