import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.js';

const VAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export function genFixtures() {
  for (const t of TASKS) {
    if (t.kind === 'fixture') {
      if (t.id === 't10') continue; // shares t6's fixture dir
      const dir = path.join(VAL, 'fixtures', t.id);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      for (const [rel, content] of Object.entries(t.fixture.files)) {
        const full = path.join(dir, rel);
        if (content === '' && rel.endsWith('.gitkeep')) { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, ''); continue; }
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      }
      const git = (args) => execFileSync('git', ['-c', 'user.email=mao@local', '-c', 'user.name=mao', ...args], { cwd: dir });
      git(['init', '-q']); git(['add', '-A']); git(['commit', '-qm', `fixture ${t.id}`]);
      console.log('fixture ready:', t.id);
    } else {
      const dir = path.join(VAL, 'repos', t.id);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', t.ref, t.repoUrl, dir], { stdio: 'inherit' });
        console.log('cloned:', t.id, t.ref);
      }
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('genFixtures.js')) genFixtures();
