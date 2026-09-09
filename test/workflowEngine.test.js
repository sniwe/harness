import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkflow } from '../src/workflowEngine.js';
import { createRunStore } from '../src/runStore.js';

function workflow() { return createWorkflow({ manifest, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'workflow-')), runId: manifest.runId }) }); }

const manifest = { schemaVersion: 1, runId: 'run-test', planDigest: 'a'.repeat(64), limits: { maxCorrectiveAttemptsPerGate: 1 }, steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], verifierProfile: 'focused', commandProfile: 'test', requiredOutputTypes: ['acceptance'] }, { stepId: 'Q0', owner: 'qwen', dependsOn: ['A0'], verifierProfile: 'focused', commandProfile: 'test', requiredOutputTypes: ['acceptance'] }] };
test('workflow persists independent evidence gates and dependencies', () => {
  const run = workflow();
  assert.equal(run.next().stepId, 'A0');
  assert.throws(() => run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass' }), /step_not_verifying/);
  run.begin('A0');
  assert.equal(run.heartbeat('A0', { phase: 'verify' }).steps.A0.heartbeat.phase, 'verify');
  const blocked = run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass' });
  assert.equal(blocked.steps.A0.status, 'blocked');
  const restored = createWorkflow({ manifest, store: run.store });
  assert.equal(restored.snapshot().steps.A0.status, 'blocked');
});

test('valid evidence unlocks the dependent step after restart', () => {
  const run = workflow();
  run.begin('A0'); run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: 'a'.repeat(64), verifier: { command: 'test', exitCode: 0 } });
  assert.equal(run.next().stepId, 'Q0');
  assert.equal(run.snapshot().steps.Q0.status, 'runnable');
});

test('candidate work can wait for peer acceptance without becoming blocked', () => {
  const run = workflow(); run.begin('A0'); const waiting = run.waitForPeer('A0', { reason: 'awaiting_qwen_contract', artifactId: 'a'.repeat(64) });
  assert.equal(waiting.steps.A0.status, 'waiting_peer'); assert.equal(run.next(), undefined); const restored = createWorkflow({ manifest, store: run.store }); assert.equal(restored.snapshot().steps.A0.status, 'waiting_peer');
  const accepted = run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: 'b'.repeat(64), verifier: { command: 'peer-acceptance', exitCode: 0 } }); assert.equal(accepted.steps.A0.status, 'succeeded');
});

test('cancellation is durable and prevents further dispatch', () => {
  const run = workflow(); run.cancel('test_cancel'); assert.equal(run.snapshot().status, 'cancelled'); assert.equal(run.next(), undefined); assert.throws(() => run.begin('A0'), /step_not_runnable/);
});

test('blocked steps can use only bounded corrective retries', () => {
  const run = workflow(); run.begin('A0'); run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'fail', outputTypes: ['acceptance'], artifactId: 'd'.repeat(64), verifier: { exitCode: 1 } }); assert.equal(run.retryStep('A0', 'repair').steps.A0.status, 'runnable'); assert.equal(run.snapshot().steps.A0.correctiveAttempts, 1); assert.throws(() => run.retryStep('A0'), /retry_denied/);
});

test('resume requires the exact artifact that caused the blocker', () => {
  const run = workflow(); const artifactId = 'e'.repeat(64); run.begin('A0'); run.accept('A0', { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'fail', outputTypes: ['acceptance'], artifactId, verifier: { exitCode: 1 } }); assert.throws(() => run.resume('f'.repeat(64)), /resolution_not_found/); assert.equal(run.resume(artifactId).steps.A0.status, 'runnable');
});

test('reconstructed workflow rejects a state from another manifest revision', () => {
  const run = workflow(); const mismatched = { ...manifest, planDigest: 'b'.repeat(64) }; assert.throws(() => createWorkflow({ manifest: mismatched, store: run.store }).snapshot(), /run_manifest_fence_mismatch/);
});

test('workflow persists the immutable manifest beside durable state', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'workflow-manifest-')); const store = createRunStore({ root, runId: manifest.runId }); createWorkflow({ manifest, store }); const saved = JSON.parse(readFileSync(store.manifestFile, 'utf8')); assert.equal(saved.planDigest, manifest.planDigest); assert.throws(() => createWorkflow({ manifest: { ...manifest, planDigest: 'b'.repeat(64) }, store }), /manifest_fence_mismatch/);
});

test('conditional steps can be skipped only with durable evidence', () => {
  const optional = { ...manifest, steps: manifest.steps.map((step) => step.stepId === 'Q0' ? { ...step, optionalPolicy: 'conditional' } : step) }; const run = createWorkflow({ manifest: optional, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'workflow-skip-')), runId: optional.runId }) }); run.begin('A0'); run.accept('A0', { runId: optional.runId, stepId: 'A0', planDigest: optional.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: 'a'.repeat(64), verifier: { exitCode: 0 } }); assert.throws(() => run.skipStep('Q0', { reason: 'not_justified', verifier: { profile: 'focused' } }), /skip_evidence_invalid/); const state = run.skipStep('Q0', { artifactId: 'b'.repeat(64), reason: 'inference_not_dominant', verifier: { profile: 'q4-disposition', exitCode: 0 } }); assert.equal(state.steps.Q0.status, 'skipped'); assert.equal(state.evidence.Q0.verdict, 'skip'); assert.equal(state.evidence.Q0.reason, 'inference_not_dominant'); assert.equal(state.status, 'accepted');
});
