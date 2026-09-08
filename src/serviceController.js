import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function createServiceController({ file, spawnImpl = spawn, probe = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  if (!file) throw new Error('service_state_file_required'); fs.mkdirSync(path.dirname(file), { recursive: true });
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const write = (state) => { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state, null, 2)); fs.renameSync(temporary, file); return state; };
  function start({ serviceId, command, args = [], cwd, env = process.env } = {}) { if (!serviceId || !command || !cwd) throw new Error('service_start_invalid'); const old = read(); if (old?.state === 'running' && probe(old.pid)) throw new Error('service_already_running'); const child = spawnImpl(command, args, { cwd, env, detached: true, stdio: 'ignore', windowsHide: true }); const state = { schemaVersion: 1, serviceId, pid: child.pid, command, args, cwd, startedAt: new Date().toISOString(), state: 'running' }; child.unref?.(); return write(state); }
  function inspect() { const state = read(); if (!state) return { state: 'missing' }; if (state.state === 'running' && !probe(state.pid)) return write({ ...state, state: 'unknown', reason: 'owned_process_missing' }); return state; }
  function stop() { const state = inspect(); if (state.state !== 'running') return state; try { process.kill(state.pid); } catch {} return write({ ...state, state: 'stopping', stoppedAt: new Date().toISOString() }); }
  return { start, inspect, stop, read };
}
