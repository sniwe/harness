import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_OUTPUT_BYTES = 1024 * 1024;

export function createDurableCommandController({ root, spawnImpl = spawn, probe = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  if (!root) throw new Error('command_root_required'); fs.mkdirSync(root, { recursive: true });
  const active = new Set();
  const fileFor = (commandId) => path.join(root, `${commandId}.json`);
  const read = (commandId) => { const file = fileFor(commandId); if (!fs.existsSync(file)) throw new Error('command_not_found'); return JSON.parse(fs.readFileSync(file, 'utf8')); };
  const write = (state) => { const file = fileFor(state.commandId); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state, null, 2)); fs.renameSync(temporary, file); return state; };
  function start({ command, args = [], cwd, env = process.env } = {}) {
    if (!command || !cwd) throw new Error('command_start_invalid');
    const commandId = crypto.randomUUID(); const startedAt = new Date().toISOString(); let output = ''; let settled = false;
    const child = spawnImpl(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: true });
    const finish = (result) => { if (settled) return; settled = true; active.delete(commandId); child.stdout?.destroy(); child.stderr?.destroy(); write({ ...read(commandId), ...result, output, finishedAt: new Date().toISOString() }); };
    const append = (chunk) => { output = (output + String(chunk)).slice(-MAX_OUTPUT_BYTES); write({ ...read(commandId), output }); };
    const initial = write({ schemaVersion: 1, commandId, command, args, cwd, startedAt, pid: child.pid, state: 'running', output: '' }); active.add(commandId);
    child.stdout?.on('data', append); child.stderr?.on('data', append); child.on('error', (error) => finish({ state: 'failed', error: error.message })); child.on('close', (exitCode, signal) => finish({ state: exitCode === 0 ? 'succeeded' : 'failed', exitCode, signal }));
    return initial;
  }
  function inspect(commandId) { const state = read(commandId); if (state.state === 'running' && !active.has(commandId) && !probe(state.pid)) return write({ ...state, state: 'unknown', reason: 'owned_process_missing', observedAt: new Date().toISOString() }); return state; }
  async function wait(commandId, { pollMs = 1000, signal } = {}) { while (true) { if (signal?.aborted) throw new Error('command_wait_cancelled'); const state = inspect(commandId); if (['succeeded', 'failed', 'unknown', 'stopping'].includes(state.state)) return state; await new Promise((resolve) => setTimeout(resolve, pollMs)); } }
  function stop(commandId) { const state = inspect(commandId); if (state.state !== 'running') return state; try { process.kill(state.pid); } catch {} return write({ ...state, state: 'stopping', stoppedAt: new Date().toISOString() }); }
  return { start, inspect, wait, stop, read };
}
