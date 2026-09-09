import test from 'node:test';
import assert from 'node:assert/strict';
import { runRestartTracer } from '../src/restartTracer.js';
import { RESTART_TRACERS, runRestartMatrix } from '../src/restartMatrix.js';

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

test('restart tracer rejects a restart that loses or reuses identity', async () => {
  let phase = 0;
  await assert.rejects(() => runRestartTracer({ name: 'app-after-seal', predicate: () => true, observe: async () => ({ runtimeGeneration: 'same', jobId: phase++ ? 'job-2' : 'job-1' }), restart: async () => {}, ready: () => true, sleep: async () => {} }), /restart_tracer_identity_invalid/);
});

test('restart matrix runs all six observed predicates with persistent polling', async () => {
  const counts = new Map(); const generations = new Map();
  const evidence = await runRestartMatrix({
    observe: async (name) => { const count = (counts.get(name) || 0) + 1; counts.set(name, count); return { observedPredicate: count === 2 ? name : '', runtimeGeneration: generations.get(name) || 'before', jobId: 'job-1', ready: count >= 3 }; },
    restart: async (name) => { generations.set(name, 'after'); },
    ready: async (name, state) => state.ready && generations.get(name) === 'after',
    sleep: async () => {},
  });
  assert.deepEqual(evidence.map((item) => item.name), [...RESTART_TRACERS]); assert.ok(evidence.every((item) => item.verdict === 'pass')); assert.ok([...counts.values()].every((count) => count >= 3));
});

test('restart matrix resumes validated completed tracers without replaying them', async () => {
  const completed = { name: 'app-during-upload', verdict: 'pass', artifactId: 'a'.repeat(64), trigger: { predicate: 'app-during-upload' }, before: { runtimeGeneration: 'g1', jobId: 'job-1' }, after: { runtimeGeneration: 'g2', jobId: 'job-1' } };
  const restarted = []; const generations = new Set(); const evidence = await runRestartMatrix({ priorEvidence: [completed], observe: async (name) => ({ observedPredicate: name, runtimeGeneration: generations.has(name) ? 'after' : 'before', jobId: `job-${name}` }), restart: async (name) => { restarted.push(name); generations.add(name); }, ready: async (name, state) => state.runtimeGeneration === 'after', sleep: async () => {} });
  assert.equal(evidence[0], completed); assert.equal(restarted.includes('app-during-upload'), false); assert.equal(restarted.length, 5);
});

test('restart matrix does not trust evidence bound to a different predicate', async () => {
  const mismatched = { name: 'app-during-upload', verdict: 'pass', artifactId: 'a'.repeat(64), trigger: { predicate: 'app-after-seal' }, before: { runtimeGeneration: 'g1', jobId: 'job-1' }, after: { runtimeGeneration: 'g2', jobId: 'job-1' } };
  let restarted = false; const generations = new Set(); const evidence = await runRestartMatrix({ priorEvidence: [mismatched], observe: async (name) => ({ observedPredicate: name, runtimeGeneration: generations.has(name) ? 'after' : 'before', jobId: 'job-2' }), restart: async (name) => { restarted = true; generations.add(name); }, ready: async (_name, state) => state.runtimeGeneration === 'after', sleep: async () => {} });
  assert.equal(restarted, true); assert.notEqual(evidence[0], mismatched); assert.equal(evidence[0].name, 'app-during-upload');
});
