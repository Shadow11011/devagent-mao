import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverSkills,
  formatSkillsForPrompt,
  getSkill,
  skillCommand,
  skillInstallHint,
  parseFrontmatter,
  validateSkill,
  detectPythonSkill,
} from '../src/skills.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'skills');
let home;
beforeEach(() => { home = mkdtempSync(path.join(tmpdir(), 'mao-skills-home-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('skills discovery', () => {
  it('discovers markdown and python skills from an explicit skills dir', () => {
    const { skills, diagnostics } = discoverSkills({ cwd: path.join(home, 'no-proj'), home: path.join(home, 'no-home'), extraPaths: [FIXTURES] });
    const names = skills.map((s) => s.name).sort();
    expect(names).toContain('valid-skill');
    expect(names).toContain('python-skill');
    // invalid-name loads with a warning (lenient), keeping its frontmatter name;
    // missing-desc is dropped.
    expect(names).toContain('WRONG-name');
    expect(names).not.toContain('missing-desc');
    expect(diagnostics.some((d) => d.type === 'warning' && d.message.includes('description is required'))).toBe(true);
  });

  it('discovers project-local skills under .mao/skills', () => {
    const dir = path.join(home, 'proj', '.mao', 'skills', 'proj-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: proj-skill\ndescription: A project skill.\n---\n\n# Project\n');
    const { skills } = discoverSkills({ cwd: path.join(home, 'proj'), home: path.join(home, 'no-home') });
    expect(skills.map((s) => s.name)).toContain('proj-skill');
  });

  it('detects python-backed skills with import name and package path', () => {
    const { skills } = discoverSkills({ cwd: path.join(home, 'no-proj'), home: path.join(home, 'no-home'), extraPaths: [FIXTURES] });
    const py = skills.find((s) => s.name === 'python-skill');
    expect(py.kind).toBe('python');
    expect(py.python.importName).toBe('python_skill');
    expect(py.python.packagePath.endsWith('python-skill')).toBe(true);
  });

  it('finds user-global skills in ~/.agents/skills', () => {
    const dir = path.join(home, '.agents', 'skills', 'global-skill');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: global-skill\ndescription: A global skill.\n---\n\n# Global\n');
    const { skills } = discoverSkills({ cwd: path.join(home, 'no-proj'), home });
    expect(skills.map((s) => s.name)).toContain('global-skill');
  });

  it('resolves collisions by keeping the first skill found (project wins)', () => {
    const projDir = path.join(home, 'proj', '.mao', 'skills', 'valid-skill');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(path.join(projDir, 'SKILL.md'), '---\nname: valid-skill\ndescription: project copy.\n---\n\n# Project\n');
    const userDir = path.join(home, '.agents', 'skills', 'valid-skill');
    mkdirSync(userDir, { recursive: true });
    writeFileSync(path.join(userDir, 'SKILL.md'), '---\nname: valid-skill\ndescription: global copy.\n---\n\n# Global\n');
    const { skills, diagnostics } = discoverSkills({ cwd: path.join(home, 'proj'), home });
    const skill = skills.find((s) => s.name === 'valid-skill');
    expect(skill.source).toBe('project');
    expect(diagnostics.some((d) => d.type === 'collision')).toBe(true);
  });
});

describe('skills format + access', () => {
  it('formats visible skills as XML and hides disable-model-invocation', () => {
    const skills = [
      { name: 'a', description: 'desc a', kind: 'markdown', filePath: '/a/SKILL.md', source: 'project', disableModelInvocation: false },
      { name: 'b', description: 'desc b', kind: 'markdown', filePath: '/b/SKILL.md', source: 'project', disableModelInvocation: true },
    ];
    const xml = formatSkillsForPrompt(skills);
    expect(xml).toContain('<available_skills>');
    expect(xml).toContain('<name>a</name>');
    expect(xml).not.toContain('<name>b</name>');
  });

  it('getSkill returns the matching skill', () => {
    const skills = [{ name: 'a', description: 'x', kind: 'markdown', filePath: '/a', source: 'project' }];
    expect(getSkill(skills, 'a').name).toBe('a');
    expect(getSkill(skills, 'b')).toBeNull();
  });
});

describe('python skill bridge contract', () => {
  it('skillCommand builds the console-script invocation', () => {
    const skill = { name: 'web-search', kind: 'python', python: { importName: 'web_search' } };
    expect(skillCommand(skill, '"prime agent" --limit 3')).toBe('web_search "prime agent" --limit 3');
    expect(skillCommand(skill)).toBe('web_search');
  });

  it('skillCommand throws for non-python skills', () => {
    expect(() => skillCommand({ name: 'a', kind: 'markdown' })).toThrow(/not Python-backed/);
  });

  it('skillInstallHint returns editable install command', () => {
    const skill = { name: 'web-search', kind: 'python', baseDir: '/skills/web-search', python: { importName: 'web_search' } };
    expect(skillInstallHint(skill)).toContain('pip install -e');
  });
});

describe('frontmatter + validation helpers', () => {
  it('parseFrontmatter handles quoted and unquoted values', () => {
    const { frontmatter, body } = parseFrontmatter('---\nname: x\ndescription: "hello world"\n---\n\nBody');
    expect(frontmatter.name).toBe('x');
    expect(frontmatter.description).toBe('hello world');
    expect(body.trim()).toBe('Body');
  });

  it('validateSkill reports name and description issues', () => {
    expect(validateSkill({ name: 'Bad', description: 'x', dirName: 'bad' })).toEqual([
      'name "Bad" does not match directory "bad"',
      'name must be lowercase a-z, 0-9, hyphens only',
    ]);
    expect(validateSkill({ name: 'ok', description: '', dirName: 'ok' })).toContain('description is required');
  });

  it('detectPythonSkill returns null without pyproject or package init', () => {
    expect(detectPythonSkill('/nonexistent', 'x')).toBeNull();
    expect(detectPythonSkill(path.join(FIXTURES, 'valid-skill'), 'valid-skill')).toBeNull();
  });
});
