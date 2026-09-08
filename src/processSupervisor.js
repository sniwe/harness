import { execFileSync } from 'node:child_process';

function terminateTree(pid) { if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(pid); }

export function createProcessSupervisor({ kill = terminateTree } = {}) {
  const owned = new Map();
  function own(pid, metadata = {}) { if (!Number.isInteger(pid) || pid <= 0) throw new Error('pid_invalid'); owned.set(pid, { pid, ...metadata }); return owned.get(pid); }
  function release(pid) { owned.delete(pid); }
  function terminate(pid) { if (!owned.has(pid)) throw new Error('process_not_owned'); try { kill(pid); } finally { owned.delete(pid); } return { pid, state: 'termination_requested' }; }
  return { own, release, terminate, list: () => [...owned.values()] };
}
