import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createProcessSupervisor } from './processSupervisor.js';

export function createServiceController({ file, spawnImpl = spawn, probe = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }, now = Date.now, supervisor = createProcessSupervisor() } = {}) {
  if (!file) throw new Error('service_state_file_required'); fs.mkdirSync(path.dirname(file), { recursive: true });
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const write = (state) => { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state, null, 2)); fs.renameSync(temporary, file); return state; };
  function start({ serviceId, command, args = [], cwd, env = process.env } = {}) { if (!serviceId || !command || !cwd) throw new Error('service_start_invalid'); const processStart = now(); const old = read(); if (old?.state === 'running' && probe(old.pid, old, processStart)) throw new Error('service_already_running'); const child = spawnImpl(command, args, { cwd, env, detached: true, stdio: 'ignore', windowsHide: true }); const state = { schemaVersion: 1, serviceId, pid: child.pid, processStart, command, args, cwd, startedAt: new Date().toISOString(), state: 'running' }; supervisor.own(child.pid, { serviceId, processStart }); child.unref?.(); return write(state); }
  function inspect() { const state = read(); if (!state) return { state: 'missing' }; if (state.state === 'running') { if (!probe(state.pid, state, state.processStart)) return write({ ...state, state: 'unknown', reason: 'owned_process_missing' }); if (!supervisor.list().some((item) => item.pid === state.pid)) supervisor.own(state.pid, { serviceId: state.serviceId, processStart: state.processStart }); } if (state.state === 'stopping' && !probe(state.pid, state, state.processStart)) return write({ ...state, state: 'stopped', stoppedAt: state.stoppedAt || new Date().toISOString() }); return state; }
  function stop() {
    const state = inspect();
    if (state.state !== 'running') return state;
    try { supervisor.terminate(state.pid); }
    catch (error) {
      if (error.message === 'process_not_owned') return write({ ...state, state: 'unknown', reason: 'process_ownership_lost', observedAt: new Date().toISOString() });
      throw error;
    }
    return write({ ...state, state: 'stopping', stoppedAt: new Date().toISOString() });
  }
  async function restart({ signal, pollMs = 250 } = {}) { const state = inspect(); if (!state || !['running', 'stopping'].includes(state.state)) throw new Error('service_restart_invalid'); if (state.state === 'running') stop(); while (true) { if (signal?.aborted) throw new Error('service_restart_cancelled'); const current = inspect(); if (current.state === 'stopped') return start({ serviceId: current.serviceId, command: current.command, args: current.args, cwd: current.cwd, env: current.env }); await new Promise((resolve) => setTimeout(resolve, pollMs)); } }
  return { start, inspect, stop, restart, read };
}
