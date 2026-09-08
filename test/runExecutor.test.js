import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readRunManifest } from '../src/runManifest.js';
import { createRunStore } from '../src/runStore.js';
import { createWorkflow } from '../src/workflowEngine.js';
import { createRunExecutor } from '../src/runExecutor.js';

test('run executor persists outcome before accepting a step and completes the graph', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-')), runId: manifest.runId, manifest });
  const workflow = createWorkflow({ manifest, store });
  const evidence = (step) => ({ runId: manifest.runId, stepId: step.stepId, planDigest: manifest.planDigest, verdict: 'pass', outputTypes: step.requiredOutputTypes, artifactId: 'a'.repeat(64), verifier: { profile: step.verifierProfile, exitCode: 0 } });
  const executor = createRunExecutor({ workflow, manifest, runner: async ({ step }) => evidence(step), sleepImpl: async () => {}, skipConditional: ['Q4', 'A5', 'Q6', 'A6'] });
  const state = await executor.run();
  assert.equal(state.status, 'accepted');
  assert.equal(executor.attempts.recover().length, manifest.steps.length - 4);
  assert.ok(executor.attempts.recover().every(({ outcome }) => outcome?.state === 'succeeded'));
});

test('run executor keeps polling when no step is currently runnable', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-wait-')), runId: manifest.runId, manifest });
  const waitingManifest = { ...manifest, steps: [{ ...manifest.steps[0], stepId: 'WAIT', dependsOn: ['missing-step'] }] };
  const workflow = createWorkflow({ manifest: waitingManifest, store });
  const controller = new AbortController(); let polls = 0;
  const execution = createRunExecutor({ workflow, manifest: waitingManifest, runner: async ({ step }) => ({ runId: waitingManifest.runId, stepId: step.stepId, planDigest: waitingManifest.planDigest, verdict: 'pass', outputTypes: step.requiredOutputTypes, artifactId: 'b'.repeat(64), verifier: { profile: step.verifierProfile, exitCode: 0 } }), pollMs: 0, sleepImpl: async () => { polls += 1; if (polls === 2) controller.abort(); } }).run({ signal: controller.signal });
  await assert.rejects(execution, /run_execution_cancelled/);
  assert.equal(polls, 2);
});

test('run executor fences an incomplete attempt after controller recovery', () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-recovery-')), runId: manifest.runId, manifest });
  const workflow = createWorkflow({ manifest, store });
  const executor = createRunExecutor({ workflow, manifest, runner: async () => { throw new Error('unused'); } });
  const started = workflow.begin('A0');
  executor.attempts.begin({ attemptId: started.steps.A0.attemptId, runId: manifest.runId, planDigest: manifest.planDigest, stepId: 'A0', operationId: 'operation-1' });
  const recovered = executor.recover();
  assert.equal(recovered[0].state, 'unknown');
  assert.equal(recovered[0].reason, 'unknown_after_crash');
  assert.equal(workflow.snapshot().steps.A0.blockReason, 'unknown_after_crash');
});

test('run executor replays a durable successful attempt after controller recovery', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const recoveryManifest = { ...manifest, steps: [manifest.steps[0]] };
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-replay-')), runId: manifest.runId, manifest });
  const workflow = createWorkflow({ manifest: recoveryManifest, store });
  const executor = createRunExecutor({ workflow, manifest: recoveryManifest, runner: async () => { throw new Error('must not replay side effect'); } });
  const started = workflow.begin('A0');
  const evidence = { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: 'c'.repeat(64), verifier: { profile: 'a0-observability', exitCode: 0 } };
  executor.attempts.begin({ attemptId: started.steps.A0.attemptId, runId: manifest.runId, planDigest: manifest.planDigest, stepId: 'A0', operationId: 'operation-2' });
  executor.attempts.finish(started.steps.A0.attemptId, { state: 'succeeded', evidence });
  const state = await executor.run();
  assert.equal(state.steps.A0.status, 'succeeded');
});

test('run executor exposes command failures as exact resumable blockers', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const recoveryManifest = { ...manifest, steps: [manifest.steps[0]] };
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-block-')), runId: manifest.runId, manifest: recoveryManifest });
  const workflow = createWorkflow({ manifest: recoveryManifest, store });
  const executor = createRunExecutor({ workflow, manifest: recoveryManifest, runner: async () => { throw new Error('verifier_failed'); } });
  const state = await executor.run();
  assert.equal(state.status, 'blocked');
  assert.equal(state.steps.A0.blockReason, 'execution_failed');
  assert.equal(executor.attempts.recover()[0].outcome.state, 'blocked');
  assert.equal(executor.attempts.recover()[0].outcome.artifactId, state.steps.A0.blockArtifactId);
});

test('run executor persists an operation intent before invoking the runner', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const recoveryManifest = { ...manifest, steps: [manifest.steps[0]] };
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-operation-')), runId: manifest.runId, manifest: recoveryManifest });
  const workflow = createWorkflow({ manifest: recoveryManifest, store }); const events = [];
  const outbox = { intent: (id, value) => { events.push(['intent', id, value]); return value; }, result: (id, value) => events.push(['result', id, value]) };
  const executor = createRunExecutor({ workflow, manifest: recoveryManifest, operationOutbox: outbox, runner: async ({ attempt }) => { assert.equal(events[0][0], 'intent'); assert.equal(events[0][1], attempt.operationId); return { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: 'd'.repeat(64), verifier: { profile: 'a0-observability', exitCode: 0 } }; } });
  await executor.run();
  assert.equal(events[1][0], 'result'); assert.equal(events[1][1], events[0][1]);
});

test('run executor replays a durable blocked outcome after controller recovery', () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const recoveryManifest = { ...manifest, steps: [manifest.steps[0]] };
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-block-replay-')), runId: manifest.runId, manifest: recoveryManifest });
  const workflow = createWorkflow({ manifest: recoveryManifest, store }); const executor = createRunExecutor({ workflow, manifest: recoveryManifest, runner: async () => { throw new Error('must not replay side effect'); } });
  const started = workflow.begin('A0'); const artifactId = 'e'.repeat(64);
  executor.attempts.begin({ attemptId: started.steps.A0.attemptId, runId: manifest.runId, planDigest: manifest.planDigest, stepId: 'A0', operationId: 'operation-3' });
  executor.attempts.finish(started.steps.A0.attemptId, { state: 'blocked', reason: 'execution_failed', artifactId });
  const recovered = executor.recover();
  assert.equal(recovered[0].state, 'blocked'); assert.equal(workflow.snapshot().steps.A0.blockArtifactId, artifactId); assert.equal(workflow.snapshot().status, 'blocked');
});

test('run executor cannot persist invalid evidence as success', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const recoveryManifest = { ...manifest, steps: [manifest.steps[0]] };
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-evidence-')), runId: manifest.runId, manifest: recoveryManifest });
  const workflow = createWorkflow({ manifest: recoveryManifest, store });
  const executor = createRunExecutor({ workflow, manifest: recoveryManifest, runner: async () => ({ runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: [], artifactId: 'f'.repeat(64), verifier: { profile: 'a0-observability', exitCode: 0 } }) });
  const state = await executor.run(); const outcome = executor.attempts.recover()[0].outcome;
  assert.equal(state.status, 'blocked'); assert.equal(outcome.state, 'blocked'); assert.match(outcome.error, /evidence_output_types_missing/);
});
