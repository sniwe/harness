import test from 'node:test';
import assert from 'node:assert/strict';
import { requireWorkerSuccess } from '../src/workerResult.js';

test('known worker failure envelopes cannot become success', () => {
  assert.equal(requireWorkerSuccess({ ok: true, result: 'done' }).ok, true);
  assert.throws(() => requireWorkerSuccess({ ok: false, error: 'turn_failed' }), /turn_failed/);
  assert.throws(() => requireWorkerSuccess({ ok: true, status: 'cancelled' }), /worker_result_failed/);
  assert.throws(() => requireWorkerSuccess({ ok: true, result: { turn: { status: 'failed', error: 'codex_turn_failed' } } }), /codex_turn_failed/);
});
