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
