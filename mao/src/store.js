import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dataDir) { this.dir = dataDir; fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true }); fs.mkdirSync(path.join(dataDir, 'sandboxes'), { recursive: true }); fs.mkdirSync(path.join(dataDir, 'materialized'), { recursive: true }); }
  newRunId() { const d = new Date(); const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; return `run-${ymd}-${Math.random().toString(36).slice(2, 6)}`; }
  runPath(id) { const p = path.join(this.dir, 'runs', id); fs.mkdirSync(p, { recursive: true }); return p; }
  sandboxesPath(id) { const p = path.join(this.dir, 'sandboxes', id); fs.mkdirSync(p, { recursive: true }); return p; }
  materializedPath(id) { const p = path.join(this.dir, 'materialized', id); return p; }
  eventsPath(id) { return path.join(this.runPath(id), 'events.jsonl'); }
  writeJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
  readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  appendEvent(runId, ev) { fs.appendFileSync(this.eventsPath(runId), JSON.stringify({ t: new Date().toISOString(), ...ev }) + '\n'); }
}
