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
