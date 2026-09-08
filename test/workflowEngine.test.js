import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkflow } from '../src/workflowEngine.js';
import { createRunStore } from '../src/runStore.js';

function workflow() { return createWorkflow({ manifest, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'workflow-')), runId: manifest.runId }) }); }

const manifest = { schemaVersion: 1, runId: 'run-test', planDigest: 'a'.repeat(64), limits: { maxCorrectiveAttemptsPerGate: 1 }, steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], verifierProfile: 'focused', commandProfile: 'test' }, { stepId: 'Q0', owner: 'qwen', dependsOn: ['A0'], verifierProfile: 'focused', commandProfile: 'test' }] };
test('workflow persists independent evidence gates and dependencies', () => {
  const run = workflow();
  assert.equal(run.next().stepId, 'A0');
  assert.throws(() => run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass' }), /step_not_verifying/);
  run.begin('A0');
  const blocked = run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass' });
  assert.equal(blocked.steps.A0.status, 'blocked');
  const restored = createWorkflow({ manifest, store: run.store });
  assert.equal(restored.snapshot().steps.A0.status, 'blocked');
});

test('valid evidence unlocks the dependent step after restart', () => {
  const run = workflow();
  run.begin('A0'); run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', artifactId: 'a'.repeat(64), verifier: { command: 'test', exitCode: 0 } });
  assert.equal(run.next().stepId, 'Q0');
  assert.equal(run.snapshot().steps.Q0.status, 'runnable');
});

test('cancellation is durable and prevents further dispatch', () => {
  const run = workflow(); run.cancel('test_cancel'); assert.equal(run.snapshot().status, 'cancelled'); assert.equal(run.next(), undefined); assert.throws(() => run.begin('A0'), /step_not_runnable/);
});

test('blocked steps can use only bounded corrective retries', () => {
  const run = workflow(); run.begin('A0'); run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'fail', artifactId: 'd'.repeat(64), verifier: { exitCode: 1 } }); assert.equal(run.retryStep('A0', 'repair').steps.A0.status, 'runnable'); assert.equal(run.snapshot().steps.A0.correctiveAttempts, 1); assert.throws(() => run.retryStep('A0'), /retry_denied/);
});

test('resume requires the exact artifact that caused the blocker', () => {
  const run = workflow(); const artifactId = 'e'.repeat(64); run.begin('A0'); run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'fail', artifactId, verifier: { exitCode: 1 } }); assert.throws(() => run.resume('f'.repeat(64)), /resolution_not_found/); assert.equal(run.resume(artifactId).steps.A0.status, 'runnable');
});
