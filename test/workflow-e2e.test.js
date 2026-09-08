import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRunStore } from '../src/runStore.js';
import { runRehearsal, renderRunReport } from '../src/rehearsal.js';

test('rehearsal executes the dependency graph and emits a reproducible report', async () => {
  const manifest = { schemaVersion: 1, runId: 'rehearsal', planDigest: 'b'.repeat(64), steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], commandProfile: 'test', verifierProfile: 'focused' }, { stepId: 'Q0', owner: 'qwen', dependsOn: ['A0'], commandProfile: 'test', verifierProfile: 'focused' }] };
  const result = await runRehearsal({ manifest, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'rehearsal-')), runId: manifest.runId }) }); assert.equal(result.ok, true); assert.deepEqual(result.trace.map((item) => item.stepId), ['A0', 'A0', 'Q0', 'Q0']); assert.match(renderRunReport({ manifest, result }), /PASS/);
});

test('rehearsal does not convert a failed verifier into acceptance', async () => {
  const manifest = { schemaVersion: 1, runId: 'rehearsal-fail', planDigest: 'c'.repeat(64), steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], commandProfile: 'test', verifierProfile: 'focused' }] };
  const result = await runRehearsal({ manifest, store: createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'rehearsal-fail-')), runId: manifest.runId }), runner: async () => ({ runId: manifest.runId, stepId: 'A0', planDigest: manifest.planDigest, verdict: 'fail', artifactId: 'd'.repeat(64), verifier: { exitCode: 1 } }) }); assert.equal(result.ok, false); assert.equal(result.state.steps.A0.status, 'blocked');
});
