import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createDeploymentManager(file) {
  if (!file) throw new Error('deployment_state_file_required'); fs.mkdirSync(path.dirname(file), { recursive: true });
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const write = (state) => { const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state, null, 2)); fs.renameSync(temporary, file); return state; };
  function stage({ runId, projectKey, previous, desired, configDigest, rollbackCommand }) { if (!runId || !projectKey || !previous || !desired || !configDigest || !rollbackCommand) throw new Error('deployment_stage_invalid'); return write({ schemaVersion: 1, deploymentId: crypto.randomUUID(), runId, projectKey, previous, desired, configDigest, rollbackCommand, state: 'staged', stagedAt: new Date().toISOString() }); }
  function activate() { const state = read(); if (!state || state.state !== 'staged') throw new Error('deployment_not_staged'); return write({ ...state, state: 'active', activatedAt: new Date().toISOString() }); }
  function markHealthy({ runtimeGeneration, commit }) { const state = read(); if (!state || state.state !== 'active' || !runtimeGeneration || !commit) throw new Error('deployment_health_invalid'); return write({ ...state, state: 'healthy', runtimeGeneration, commit, healthyAt: new Date().toISOString() }); }
  function rollback(reason) { const state = read(); if (!state || !['active', 'healthy'].includes(state.state)) throw new Error('deployment_rollback_invalid'); return write({ ...state, state: 'rollback_required', reason: String(reason || 'health_deadline_exceeded'), rollbackAt: new Date().toISOString(), restore: state.previous }); }
  return { read, stage, activate, markHealthy, rollback };
}
