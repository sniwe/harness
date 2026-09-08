import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRunStore } from '../src/runStore.js';
import { runRehearsal, renderRunReport } from '../src/rehearsal.js';
import { adaptAudepSteps } from '../src/audepPlanAdapter.js';

test('rehearsal executes the dependency graph and emits a reproducible report', async () => {
  const manifest = { schemaVersion: 1, runId: 'rehearsal', planDigest: 'b'.repeat(64), steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], commandProfile: 'test', verifierProfile: 'focused', requiredOutputTypes: ['acceptance'] }, { stepId: 'Q0', owner: 'qwen', dependsOn: ['A0'], commandProfile: 'test', verifierProfile: 'focused', requiredOutputTypes: ['acceptance'] }] };
  const result = await runRehearsal({ manifest, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'rehearsal-')), runId: manifest.runId }) }); assert.equal(result.ok, true); assert.deepEqual(result.trace.map((item) => item.stepId), ['A0', 'A0', 'Q0', 'Q0']); assert.match(renderRunReport({ manifest, result }), /PASS/); assert.match(renderRunReport({ manifest, result }), /owner app/);
});

test('rehearsal does not convert a failed verifier into acceptance', async () => {
  const manifest = { schemaVersion: 1, runId: 'rehearsal-fail', planDigest: 'c'.repeat(64), steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], commandProfile: 'test', verifierProfile: 'focused', requiredOutputTypes: ['acceptance'] }] };
  const result = await runRehearsal({ manifest, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'rehearsal-fail-')), runId: manifest.runId }), runner: async () => ({ runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'fail', outputTypes: ['acceptance'], artifactId: 'd'.repeat(64), verifier: { exitCode: 1 } }) }); assert.equal(result.ok, false); assert.equal(result.state.steps.A0.status, 'blocked');
});

test('rehearsal retains worker exceptions as a durable blocked result', async () => {
  const manifest = { schemaVersion: 1, runId: 'rehearsal-error', planDigest: 'd'.repeat(64), steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], commandProfile: 'test', verifierProfile: 'focused', requiredOutputTypes: ['acceptance'] }] };
  const result = await runRehearsal({ manifest, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'rehearsal-error-')), runId: manifest.runId }), runner: async () => { throw new Error('worker_died'); } }); assert.equal(result.ok, false); assert.equal(result.state.steps.A0.status, 'blocked'); assert.equal(result.state.steps.A0.blockReason, 'evidence_missing_or_invalid'); assert.match(renderRunReport({ manifest, result }), /BLOCKED/);
});

test('full normalized graph survives restart, retry, aliases, and optional dispositions', async () => {
  const ids = ['A0', 'Q0', 'A1', 'Q1', 'A2A', 'A2B', 'A3', 'A4', 'Q2', 'Q3', 'Q4', 'Q5', 'A5', 'Q6', 'A6', 'Q7', 'A7'];
  const deps = { A0: [], Q0: [], A1: ['A0'], Q1: ['Q0'], A2A: ['A1'], A2B: ['A2A', 'Q1'], A3: ['A2B'], A4: ['A3'], Q2: ['Q1', 'A4'], Q3: ['Q2'], Q4: ['Q3'], Q5: ['Q4'], A5: ['A4'], Q6: ['Q5', 'A5'], A6: ['Q6'], Q7: ['A6'], A7: ['Q7'] };
  const manifest = { schemaVersion: 1, runId: 'full-rehearsal', planDigest: 'e'.repeat(64), limits: { maxCorrectiveAttemptsPerGate: 1 }, steps: ids.map((stepId) => ({ stepId, owner: stepId[0] === 'Q' ? 'qwen' : 'app', dependsOn: deps[stepId], commandProfile: 'test', verifierProfile: stepId.toLowerCase(), requiredOutputTypes: ['acceptance'], rollbackProfile: 'preserve', optionalPolicy: ['Q4', 'A5', 'Q6', 'A6'].includes(stepId) ? 'conditional' : 'required' })) };
  let first = true; const result = await runRehearsal({ manifest, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'full-rehearsal-')), runId: manifest.runId }), restartAfterStep: true, skipSteps: ['Q4', 'A5', 'Q6', 'A6'], retrySteps: { A0: 1 }, runner: async ({ step }) => { if (step.stepId === 'A0' && first) { first = false; return { runId: manifest.runId, stepId: step.stepId, planDigest: manifest.planDigest, verdict: 'fail', outputTypes: ['acceptance'], artifactId: 'f'.repeat(64), verifier: { profile: step.verifierProfile, exitCode: 1 } }; } return { runId: manifest.runId, stepId: step.stepId, planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: `${step.stepId}${'a'.repeat(64)}`.slice(0, 64), verifier: { profile: step.verifierProfile, exitCode: 0 } }; } });
  assert.equal(result.ok, true); assert.equal(result.state.status, 'accepted'); assert.equal(result.state.steps.Q4.status, 'skipped'); assert.equal(result.state.steps.A7.status, 'succeeded'); assert.ok(result.trace.some((item) => item.state === 'retry_wait')); assert.equal(result.trace.filter((item) => item.state === 'running').length, ids.length - 4 + 1); assert.equal(adaptAudepSteps([{ stepId: 'A6', artifactFilename: 'main-app-speed-a5-adaptive-boundary-v2-acceptance.md' }])[0].artifactFilename, 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md');
});
