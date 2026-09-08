import { spawn } from 'node:child_process';

export function runCommand({ command, args = [], cwd, env = process.env, spawnImpl = spawn } = {}) {
  if (!command || !cwd) return Promise.reject(new Error('command_profile_invalid'));
  const startedAt = new Date().toISOString(); const start = Date.now();
  return new Promise((resolve) => {
    let output = ''; let settled = false;
    const child = spawnImpl(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const finish = (result) => { if (settled) return; settled = true; resolve({ ...result, command, args, cwd, startedAt, durationMs: Date.now() - start, output }); };
    child.stdout?.on('data', (chunk) => { output += chunk; }); child.stderr?.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => finish({ state: 'failed', error: error.message }));
    child.on('close', (code, signal) => finish({ state: code === 0 ? 'succeeded' : 'failed', exitCode: code, signal }));
  });
}
