import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createDeploymentManager } from '../src/deploymentManager.js';

test('deployment journal preserves previous generation and explicit rollback', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deploy-')), 'deployment.json'); const manager = createDeploymentManager(file); const staged = manager.stage({ runId: 'r', projectKey: 'qwen-asr', previous: { commit: 'old' }, desired: { commit: 'new' }, configDigest: 'a'.repeat(64), rollbackCommand: ['restore', 'old'] }); assert.equal(staged.state, 'staged'); assert.match(readFileSync(file, 'utf8'), /"staged"/); manager.activate(); manager.markHealthy({ runtimeGeneration: 'g2', commit: 'new' }); const rolledBack = manager.rollback('health_timeout'); assert.equal(rolledBack.state, 'rollback_required'); assert.equal(rolledBack.restore.commit, 'old');
});

test('deployment health waits by observation and supports cancellation without a deadline', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deploy-wait-')), 'deployment.json'); const manager = createDeploymentManager(file);
  manager.stage({ runId: 'r', projectKey: 'qwen-asr', previous: { commit: 'old' }, desired: { commit: 'new' }, configDigest: 'b'.repeat(64), rollbackCommand: ['restore', 'old'] }); manager.activate();
  let polls = 0; const healthy = await manager.waitForHealthy({ observe: async () => (++polls < 2 ? { state: 'starting' } : { state: 'healthy', runtimeGeneration: 'g2', commit: 'new' }), sleep: async () => {} });
  assert.equal(healthy.state, 'healthy'); assert.equal(polls, 2);
  const controller = new AbortController(); controller.abort(); await assert.rejects(() => manager.waitForHealthy({ observe: async () => ({ state: 'starting' }), signal: controller.signal }), /deployment_health_wait_cancelled/);
});

test('deployment rollback records an observation failure without a deadline claim', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deploy-rollback-')), 'deployment.json'); const manager = createDeploymentManager(file);
  manager.stage({ runId: 'r', projectKey: 'main-app', previous: { commit: 'old' }, desired: { commit: 'new' }, configDigest: 'c'.repeat(64), rollbackCommand: ['restore', 'old'] }); manager.activate();
  assert.equal(manager.rollback().reason, 'health_not_observed');
});

test('deployment health rejects a healthy process from the wrong generation and keeps polling', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deploy-generation-')), 'deployment.json'); const manager = createDeploymentManager(file);
  manager.stage({ runId: 'r', projectKey: 'main-app', previous: { commit: 'old' }, desired: { commit: 'new' }, configDigest: 'd'.repeat(64), rollbackCommand: ['restore', 'old'] }); manager.activate();
  let polls = 0; const healthy = await manager.waitForHealthy({ observe: async () => (++polls === 1 ? { state: 'healthy', runtimeGeneration: 'wrong', commit: 'old' } : { state: 'healthy', runtimeGeneration: 'right', commit: 'new' }), sleep: async () => {} });
  assert.equal(healthy.commit, 'new'); assert.equal(polls, 2); assert.equal(manager.read().lastHealthObservation.commit, 'old');
});

test('deployment rollback executes once and persistently observes the restored generation', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deploy-execute-')), 'deployment.json'); const manager = createDeploymentManager(file); let executions = 0; let polls = 0;
  manager.stage({ runId: 'r', projectKey: 'main-app', previous: { commit: 'old' }, desired: { commit: 'new' }, configDigest: 'e'.repeat(64), rollbackCommand: ['restore-scoped', 'old'] }); manager.activate(); manager.rollback('unhealthy_candidate');
  const restored = await manager.executeRollback({ execute: async (command) => { executions += 1; assert.deepEqual(command, ['restore-scoped', 'old']); }, observe: async (previous) => (++polls < 2 ? { state: 'starting', commit: previous.commit } : { state: 'healthy', commit: previous.commit, runtimeGeneration: 'old:2' }), sleep: async () => {} });
  assert.equal(executions, 1); assert.equal(polls, 2); assert.equal(restored.state, 'restored'); assert.equal(manager.read().rollbackExecution.state, 'restored');
});

test('deployment rollback execution cancellation preserves the running execution record', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deploy-cancel-')), 'deployment.json'); const manager = createDeploymentManager(file); const controller = new AbortController();
  manager.stage({ runId: 'r', projectKey: 'main-app', previous: { commit: 'old' }, desired: { commit: 'new' }, configDigest: 'f'.repeat(64), rollbackCommand: ['restore', 'old'] }); manager.activate(); manager.rollback();
  await assert.rejects(() => manager.executeRollback({ execute: async () => {}, observe: async () => { controller.abort(); return { state: 'starting' }; }, signal: controller.signal }), /deployment_rollback_cancelled/);
  assert.equal(manager.read().rollbackExecution.state, 'running');
});

test('deployment rollback does not execute a restore after pre-cancellation', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deploy-pre-cancel-')), 'deployment.json'); const manager = createDeploymentManager(file); const controller = new AbortController(); let executions = 0;
  manager.stage({ runId: 'r', projectKey: 'main-app', previous: { commit: 'old' }, desired: { commit: 'new' }, configDigest: '1'.repeat(64), rollbackCommand: ['restore', 'old'] }); manager.activate(); manager.rollback(); controller.abort();
  await assert.rejects(() => manager.executeRollback({ execute: async () => { executions += 1; }, observe: async () => ({ state: 'healthy', commit: 'old', runtimeGeneration: 'old:2' }), signal: controller.signal }), /deployment_rollback_cancelled/);
  assert.equal(executions, 0); assert.equal(manager.read().rollbackExecution, undefined);
});

test('deployment rollback does not replay a failed restore without resolution', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'deploy-failed-')), 'deployment.json'); const manager = createDeploymentManager(file); let executions = 0;
  manager.stage({ runId: 'r', projectKey: 'main-app', previous: { commit: 'old' }, desired: { commit: 'new' }, configDigest: '2'.repeat(64), rollbackCommand: ['restore', 'old'] }); manager.activate(); manager.rollback();
  await assert.rejects(() => manager.executeRollback({ execute: async () => { executions += 1; throw new Error('restore_uncertain'); }, observe: async () => ({ state: 'starting' }), sleep: async () => {} }), /restore_uncertain/);
  await assert.rejects(() => manager.executeRollback({ execute: async () => { executions += 1; }, observe: async () => ({ state: 'healthy', commit: 'old', runtimeGeneration: 'old:2' }), sleep: async () => {} }), /deployment_rollback_execution_failed/);
  assert.equal(executions, 1); assert.equal(manager.read().rollbackExecution.state, 'failed');
});
