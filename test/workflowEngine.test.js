import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createWorkflow } from '../src/workflowEngine.js';
import { createRunStore } from '../src/runStore.js';

function workflow() { return createWorkflow({ manifest, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'workflow-')), runId: manifest.runId }) }); }

const manifest = { schemaVersion: 1, runId: 'run-test', planDigest: 'a'.repeat(64), steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], verifierProfile: 'focused', commandProfile: 'test' }, { stepId: 'Q0', owner: 'qwen', dependsOn: ['A0'], verifierProfile: 'focused', commandProfile: 'test' }] };
test('workflow persists independent evidence gates and dependencies', () => {
  const run = workflow();
  assert.equal(run.next().stepId, 'A0');
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
