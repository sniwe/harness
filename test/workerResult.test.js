import test from 'node:test';
import assert from 'node:assert/strict';
import { requireWorkerSuccess } from '../src/workerResult.js';

test('known worker failure envelopes cannot become success', () => {
  assert.equal(requireWorkerSuccess({ ok: true, result: 'done' }).ok, true);
  assert.throws(() => requireWorkerSuccess({ ok: false, error: 'turn_failed' }), /turn_failed/);
  assert.throws(() => requireWorkerSuccess({ ok: true, status: 'cancelled' }), /worker_result_failed/);
  assert.throws(() => requireWorkerSuccess({ ok: true, result: { turn: { status: 'failed', error: 'codex_turn_failed' } } }), /codex_turn_failed/);
});

test('worker success requires the observed project execution identity when requested', () => {
  const execution = { cwd: 'C:\\project', projectKey: 'app', runtimeGeneration: 'g1', threadId: 't1', turnId: 'u1' };
  assert.equal(requireWorkerSuccess({ ok: true, execution }, { expectedCwd: execution.cwd, expectedProjectKey: execution.projectKey }).ok, true);
  assert.throws(() => requireWorkerSuccess({ ok: true, execution: { ...execution, cwd: 'C:\\other' } }, { expectedCwd: execution.cwd, expectedProjectKey: execution.projectKey }), /worker_execution_cwd_mismatch/);
  assert.throws(() => requireWorkerSuccess({ ok: true, execution: { ...execution, projectKey: 'qwen' } }, { expectedCwd: execution.cwd, expectedProjectKey: execution.projectKey }), /worker_execution_project_mismatch/);
  assert.throws(() => requireWorkerSuccess({ ok: true, execution: { cwd: execution.cwd, projectKey: execution.projectKey } }, { expectedCwd: execution.cwd, expectedProjectKey: execution.projectKey }), /worker_execution_identity_missing/);
});
