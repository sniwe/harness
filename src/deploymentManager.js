import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createDeploymentManager(file) {
  if (!file) throw new Error('deployment_state_file_required'); fs.mkdirSync(path.dirname(file), { recursive: true });
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const write = (state) => { const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`; const fd = fs.openSync(temporary, 'wx'); try { fs.writeSync(fd, JSON.stringify(state, null, 2) + '\n', null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } try { fs.renameSync(temporary, file); } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } } return state; };
  function stage({ runId, projectKey, previous, desired, configDigest, rollbackCommand }) { if (!runId || !projectKey || !previous || !desired || !configDigest || !rollbackCommand) throw new Error('deployment_stage_invalid'); return write({ schemaVersion: 1, deploymentId: crypto.randomUUID(), runId, projectKey, previous, desired, configDigest, rollbackCommand, state: 'staged', stagedAt: new Date().toISOString() }); }
  function activate() { const state = read(); if (!state || state.state !== 'staged') throw new Error('deployment_not_staged'); return write({ ...state, state: 'active', activatedAt: new Date().toISOString() }); }
  function markHealthy({ runtimeGeneration, commit }) { const state = read(); if (!state || state.state !== 'active' || !runtimeGeneration || !commit) throw new Error('deployment_health_invalid'); return write({ ...state, state: 'healthy', runtimeGeneration, commit, healthyAt: new Date().toISOString() }); }
  function rollback(reason) { const state = read(); if (!state || !['active', 'healthy'].includes(state.state)) throw new Error('deployment_rollback_invalid'); return write({ ...state, state: 'rollback_required', reason: String(reason || 'health_not_observed'), rollbackAt: new Date().toISOString(), restore: state.previous }); }
  async function waitForHealthy({ observe, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs = 1000, signal } = {}) {
    if (typeof observe !== 'function') throw new Error('deployment_observer_required');
    while (true) {
      if (signal?.aborted) throw new Error('deployment_health_wait_cancelled');
      const observed = await observe();
      if (observed?.state === 'healthy' && observed.runtimeGeneration && observed.commit) return markHealthy({ runtimeGeneration: observed.runtimeGeneration, commit: observed.commit });
      await sleep(pollMs);
    }
  }
  return { read, stage, activate, markHealthy, waitForHealthy, rollback };
}
