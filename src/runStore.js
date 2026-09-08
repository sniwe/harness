import fs from 'node:fs';
import path from 'node:path';

export function createRunStore({ root = path.resolve(process.env.TICKETS_LOG_ROOT || 'data/machine-base', 'runs'), runId } = {}) {
  if (!runId) throw new Error('run_id_required');
  const dir = path.join(root, runId);
  const stateFile = path.join(dir, 'state.json');
  const eventsFile = path.join(dir, 'events.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  function read() { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
  function events() { if (!fs.existsSync(eventsFile)) return []; return fs.readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  function write(state) {
    const temporary = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, stateFile);
    return state;
  }
  function append(event) { fs.appendFileSync(eventsFile, JSON.stringify({ eventId: `${Date.now()}-${process.pid}`, eventAt: new Date().toISOString(), ...event }) + '\n', 'utf8'); }
  function initialize(state) { if (fs.existsSync(stateFile)) return read(); append({ type: 'run_initialized', runId }); return write(state); }
  return { dir, read, events, write, append, initialize };
}
