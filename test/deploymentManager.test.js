import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createDeploymentManager } from '../src/deploymentManager.js';

test('deployment journal preserves previous generation and explicit rollback', () => {
  const manager = createDeploymentManager(path.join(mkdtempSync(path.join(tmpdir(), 'deploy-')), 'deployment.json')); const staged = manager.stage({ runId: 'r', projectKey: 'qwen-asr', previous: { commit: 'old' }, desired: { commit: 'new' }, configDigest: 'a'.repeat(64), rollbackCommand: ['restore', 'old'] }); assert.equal(staged.state, 'staged'); manager.activate(); manager.markHealthy({ runtimeGeneration: 'g2', commit: 'new' }); const rolledBack = manager.rollback('health_timeout'); assert.equal(rolledBack.state, 'rollback_required'); assert.equal(rolledBack.restore.commit, 'old');
});
