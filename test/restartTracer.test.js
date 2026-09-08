import test from 'node:test';
import assert from 'node:assert/strict';
import { runRestartTracer } from '../src/restartTracer.js';

test('restart tracer waits on observed stages and preserves the durable job identity', async () => {
  let phase = 0; let restarts = 0; const observations = () => ({ runtimeGeneration: phase < 2 ? 'g1' : 'g2', jobId: 'job-1', stage: phase++ });
  const evidence = await runRestartTracer({ name: 'qwen-during-alignment', predicate: (state) => state.stage === 1, observe: observations, restart: async () => { restarts += 1; }, ready: (state) => state.stage >= 2, sleep: async () => {} });
  assert.equal(restarts, 1); assert.equal(evidence.before.jobId, evidence.after.jobId); assert.notEqual(evidence.before.runtimeGeneration, evidence.after.runtimeGeneration); assert.match(evidence.artifactId, /^[0-9a-f]{64}$/);
});

test('restart tracer supports cancellation while polling an indeterminate stage', async () => {
  const controller = new AbortController(); let polls = 0;
  await assert.rejects(() => runRestartTracer({ name: 'app-during-upload', predicate: () => false, observe: async () => { polls += 1; controller.abort(); return {}; }, restart: async () => {}, ready: () => true, sleep: async () => {}, signal: controller.signal }), /restart_tracer_cancelled/);
  assert.equal(polls, 1);
});
