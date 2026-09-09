import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readRunManifest } from '../src/runManifest.js';
import { createRunStore } from '../src/runStore.js';
import { createWorkflow } from '../src/workflowEngine.js';
import { createRunExecutor } from '../src/runExecutor.js';
import { createAttemptStore } from '../src/attemptStore.js';

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
  assert.equal(store.events().filter((event) => event.type === 'attempt_started').length, manifest.steps.length - 4);
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
  const executor = createRunExecutor({ workflow, manifest: recoveryManifest, autoRetry: false, runner: async () => { throw new Error('verifier_failed'); } });
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

test('run executor emits durable heartbeats during an indeterminate runner', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const recoveryManifest = { ...manifest, steps: [manifest.steps[0]] };
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-heartbeat-')), runId: manifest.runId, manifest: recoveryManifest });
  const workflow = createWorkflow({ manifest: recoveryManifest, store }); let release; let heartbeats = 0;
  const executor = createRunExecutor({ workflow, manifest: recoveryManifest, heartbeatMs: 1, runner: async () => { await new Promise((resolve) => { release = resolve; }); return { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: '1'.repeat(64), verifier: { profile: 'a0-observability', exitCode: 0 } }; } });
  const originalHeartbeat = workflow.heartbeat; workflow.heartbeat = (...args) => { heartbeats += 1; return originalHeartbeat(...args); };
  const running = executor.run(); await new Promise((resolve) => setTimeout(resolve, 5)); assert.ok(heartbeats > 1); release(); const state = await running; assert.equal(state.status, 'accepted');
});

test('run executor retries recoverable failures within the manifest bound', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const recoveryManifest = { ...manifest, steps: [manifest.steps[0]] };
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-retry-')), runId: manifest.runId, manifest: recoveryManifest });
  const workflow = createWorkflow({ manifest: recoveryManifest, store }); let calls = 0;
  const executor = createRunExecutor({ workflow, manifest: recoveryManifest, runner: async () => { calls += 1; if (calls === 1) throw new Error('transient_verifier_failure'); return { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: '2'.repeat(64), verifier: { profile: 'a0-observability', exitCode: 0 } }; } });
  const state = await executor.run();
  assert.equal(state.status, 'accepted'); assert.equal(calls, 2); assert.equal(executor.attempts.recover().length, 2);
});

test('run executor persists and resumes a durable command identity', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false });
  const recoveryManifest = { ...manifest, steps: [manifest.steps[0]] };
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-executor-command-')), runId: manifest.runId, manifest: recoveryManifest });
  const workflow = createWorkflow({ manifest: recoveryManifest, store }); const commandId = 'command-1';
  const evidence = { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: '9'.repeat(64), verifier: { profile: 'a0-observability', exitCode: 0 } };
  const controller = { start: () => ({ commandId, state: 'running' }), inspect: () => ({ commandId, state: 'running' }), wait: async () => ({ commandId, state: 'succeeded', output: JSON.stringify(evidence) }) };
  const executor = createRunExecutor({ workflow, manifest: recoveryManifest, durableCommandController: controller, resolveCommand: () => ({ command: process.execPath, args: [], cwd: process.cwd() }) });
  const first = await executor.run(); assert.equal(first.status, 'accepted'); assert.equal(executor.attempts.recover()[0].input.commandId, commandId);

  const secondRoot = mkdtempSync(path.join(tmpdir(), 'run-executor-command-recovery-')); const secondStore = createRunStore({ root: secondRoot, runId: manifest.runId, manifest: recoveryManifest });
  const secondWorkflow = createWorkflow({ manifest: recoveryManifest, store: secondStore }); const started = secondWorkflow.begin('A0'); const secondAttempts = createAttemptStore(secondStore.dir);
  secondAttempts.begin({ attemptId: started.steps.A0.attemptId, runId: manifest.runId, planDigest: manifest.planDigest, stepId: 'A0', operationId: 'operation-recovered', commandId });
  const recoveredExecutor = createRunExecutor({ workflow: secondWorkflow, manifest: recoveryManifest, attemptStore: secondAttempts, durableCommandController: controller, resolveCommand: () => ({ command: process.execPath, args: [], cwd: process.cwd() }) });
  const recovered = await recoveredExecutor.run(); assert.equal(recovered.status, 'accepted'); assert.equal(recovered.steps.A0.status, 'succeeded');
});

test('run executor reads complete evidence from a durable command output artifact', async () => {
  const manifest = readRunManifest('config/runs/audep-speed-local.json', { verifyInputs: false }); const root = mkdtempSync(path.join(tmpdir(), 'executor-output-artifact-')); const runStore = createRunStore({ root, runId: manifest.runId }); const workflow = createWorkflow({ manifest, store: runStore });
  const evidence = { runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: '8'.repeat(64), verifier: { profile: 'a0-observability', exitCode: 0 } }; const outputFile = path.join(root, 'command.output.log'); writeFileSync(outputFile, `${'x'.repeat(1024 * 1024)}\n${JSON.stringify(evidence)}\n`);
  const controller = { start: () => ({ commandId: 'artifact-command', state: 'running' }), wait: async () => ({ commandId: 'artifact-command', state: 'succeeded', output: 'truncated', outputFile }), inspect: () => ({ commandId: 'artifact-command', state: 'succeeded', output: 'truncated', outputFile }) };
  const executor = createRunExecutor({ workflow, manifest, durableCommandController: controller, resolveCommand: () => ({ command: process.execPath, args: [], cwd: process.cwd() }) }); const state = await executor.run(); assert.equal(state.steps.A0.status, 'succeeded');
});
