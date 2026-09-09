import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptAudepSteps, canonicalArtifactName, isExactArtifactMatch } from '../src/audepPlanAdapter.js';
import { validateBenchmarkResult } from '../src/benchmarkSchema.js';
import { joinBenchmarkResults } from '../src/benchmarkJoin.js';
import { evaluateFinalAcceptance, recordFinalAcceptance, REQUIRED_RESTARTS } from '../src/finalAcceptance.js';
import { validateHandoff } from '../src/handoffSchemas.js';
import { createBenchmarkCoordinator } from '../src/benchmarkCoordinator.js';
import { evaluateWarmBenchmarkCohort } from '../src/benchmarkCohort.js';
import { createRunStore } from '../src/runStore.js';
import { evaluateEvidence } from '../src/gateEvaluator.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const passEvidence = { source: { basename: '987.wav', durationMs: 1000, sha256: 'b'.repeat(64), revision: 'source-revision-1', planVersion: '12.5s-primary-plus-5s-boundary-v1', callCount: 103 }, manifestDigest: 'd'.repeat(64), browserEvidence: { normalBrowser: true, selection: true, persisted: true }, localization: { valid: true, revision: 'e'.repeat(64) }, metrics: { committedRealtime: 0.5 }, correctness: { canonicalHash: 'c'.repeat(64), sourceTimeProbes: true, beyondFrontierNotReady: true }, timings: { firstCommittedMs: 1, finalReadyMs: 2, steadyInterval: { committedAudioMs: 100, elapsedMs: 200 } }, finalAcceptance: { status: 'accepted', eventId: 'event-1' } };

test('AudEp filename aliases are exact and canonicalized', () => {
  assert.equal(canonicalArtifactName('main-app-speed-a5-adaptive-boundary-v2-acceptance.md'), 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md');
  assert.equal(isExactArtifactMatch('main-app-speed-a5-adaptive-boundary-v2-acceptance.md', 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md'), true);
  assert.equal(isExactArtifactMatch('main-app-speed-a6-adaptive-boundary-v2-acceptance.md', 'main-app-speed-a5-adaptive-boundary-v2-acceptance.md'), true);
  assert.equal(isExactArtifactMatch('bad-a5-adaptive-boundary-v2-acceptance.md', 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md'), false);
  assert.equal(adaptAudepSteps([{ stepId: 'A6' }])[0].gateId, 'a6-adaptive-v2-acceptance');
});

test('recognized audEp gates reject evidence from the wrong verifier profile', () => {
  const manifest = { protocolBaseline: '12.5s-primary-plus-5s-boundary-v1', runId: 'r', planDigest: 'a'.repeat(64) };
  const step = { stepId: 'A1', verifierProfile: 'a1-byte-hash', requiredOutputTypes: ['acceptance'] };
  const evidence = { runId: 'r', stepId: 'A1', planDigest: manifest.planDigest, verdict: 'pass', outputTypes: ['acceptance'], artifactId: 'a'.repeat(64), verifier: { profile: 'generic-pass' } };
  assert.deepEqual(evaluateEvidence({ manifest, step, evidence }), { ok: false, reason: 'evidence_verifier_profile_mismatch', gateId: 'a1-byte-hash-equivalence' });
});

test('handoff filenames cannot escape the receiving directory', () => {
  const descriptor = { schemaVersion: 1, runId: 'r', artifactType: 'x', producerPhase: 'Q1', producer: { machineKey: 'q', projectKey: 'qwen-asr', commit: 'c'.repeat(40), runtimeGeneration: 'g1' }, consumer: { machineKey: 'a', projectKey: 'main-app', phase: 'A2B' }, filename: 'x.md', requiredAcceptanceType: 'x', artifact: { sha256: 'a'.repeat(64), byteLength: 1, mediaType: 'text/plain' } };
  assert.equal(validateHandoff(descriptor), true);
  assert.throws(() => validateHandoff({ ...descriptor, filename: '../x.md' }), /filename_invalid/);
  assert.throws(() => validateHandoff({ ...descriptor, filename: 'nested/x.md' }), /filename_invalid/);
});

test('benchmark pass requires independent correctness, timing, and bilateral acceptance evidence', () => {
  const result = { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', ...passEvidence };
  assert.equal(validateBenchmarkResult(result), true); assert.throws(() => validateBenchmarkResult({ ...result, localization: { valid: false } }), /pass_evidence_invalid/);
  assert.throws(() => validateBenchmarkResult({ ...result, verdict: 'done' }), /benchmark_result_invalid/); assert.throws(() => validateBenchmarkResult({ ...result, source: { ...result.source, durationMs: -1 } }), /benchmark_result_invalid/);
});

test('warm benchmark cohort requires pinned comparable runs and reports median/range', () => {
  const base = { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', warm: true, configurationDigest: 'f'.repeat(64), ...passEvidence };
  const runs = [0.6, 0.8, 0.7].map((rate, index) => ({ ...base, benchmarkId: `b${index}`, metrics: { ...base.metrics, committedRealtime: rate } })); const cohort = evaluateWarmBenchmarkCohort(runs);
  assert.equal(cohort.ok, true); assert.equal(cohort.medianRealtime, 0.7); assert.deepEqual(cohort.range, { minimum: 0.6, maximum: 0.8 }); assert.equal(evaluateWarmBenchmarkCohort(runs.slice(0, 2)).reason, 'warm_cohort_insufficient_runs');
  assert.equal(evaluateWarmBenchmarkCohort(runs.map((run, index) => index === 1 ? { ...run, configurationDigest: 'e'.repeat(64) } : run)).reason, 'warm_cohort_identity_mismatch'); assert.equal(evaluateWarmBenchmarkCohort(runs.map((run, index) => index === 0 ? { ...run, metrics: { ...run.metrics, committedRealtime: 0.49 } } : run)).verdict, 'failed');
});

test('benchmark execution identity and running state survive coordinator reconstruction', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'benchmark-')); const runStore = createRunStore({ root, runId: 'r' }); const base = { schemaVersion: 1, runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', ...passEvidence }; let release; const pending = new Promise((resolve) => { release = resolve; }); const first = createBenchmarkCoordinator({ store: runStore, runId: 'r' }); const running = first.execute({}, async ({ benchmarkId }) => { await pending; return { ...base, benchmarkId }; }, { benchmarkId: 'b1' }); while (first.active !== 1) await new Promise((resolve) => setTimeout(resolve, 1)); const rebuilt = createBenchmarkCoordinator({ store: createRunStore({ root, runId: 'r' }), runId: 'r' }); assert.equal(rebuilt.inspect('b1').status, 'running'); assert.equal(rebuilt.active, 1); release(); await running; assert.equal(rebuilt.inspect('b1').status, 'succeeded');
});

test('benchmark capacity is enforced without a durable store', async () => {
  const coordinator = createBenchmarkCoordinator({ runId: 'r', maxConcurrent: 1 }); let release; const pending = new Promise((resolve) => { release = resolve; }); const result = { schemaVersion: 1, benchmarkId: 'b1', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', ...passEvidence }; const first = coordinator.execute({}, async ({ benchmarkId }) => { await pending; return { ...result, benchmarkId }; }); while (coordinator.active !== 1) await new Promise((resolve) => setTimeout(resolve, 1)); await assert.rejects(() => coordinator.execute({}, async () => result), /capacity_exhausted/); release(); await first; assert.equal(coordinator.active, 0);
});

test('failed durable benchmark identity cannot replay as success', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'benchmark-fail-')); const store = createRunStore({ root, runId: 'r' }); const coordinator = createBenchmarkCoordinator({ store, runId: 'r' }); await assert.rejects(() => coordinator.execute({}, async () => { throw new Error('runner_failed'); }, { benchmarkId: 'failed-1' }), /runner_failed/); await assert.rejects(() => coordinator.execute({}, async () => { throw new Error('should_not_run'); }, { benchmarkId: 'failed-1' }), /runner_failed/);
});

test('benchmark wait persistently observes a durable identity after restart', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'benchmark-wait-')); const store = createRunStore({ root, runId: 'r' }); const first = createBenchmarkCoordinator({ store, runId: 'r' });
  first.execute({}, async () => new Promise(() => {}), { benchmarkId: 'wait-1' });
  let polls = 0; const second = createBenchmarkCoordinator({ store: createRunStore({ root, runId: 'r' }), runId: 'r' });
  const result = await second.wait('wait-1', { pollMs: 0, sleep: async () => {}, observe: async () => (++polls < 2 ? { status: 'running' } : { status: 'succeeded', result: { schemaVersion: 1, benchmarkId: 'wait-1', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', ...passEvidence } }) });
  assert.equal(result.benchmarkId, 'wait-1'); assert.equal(polls, 2);
});

test('benchmark wait survives transient observer failures', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'benchmark-observer-')); const store = createRunStore({ root, runId: 'r' }); const first = createBenchmarkCoordinator({ store, runId: 'r' });
  first.execute({}, async () => new Promise(() => {}), { benchmarkId: 'b1' });
  await new Promise((resolve) => setImmediate(resolve)); let polls = 0; const rebuilt = createBenchmarkCoordinator({ store: createRunStore({ root, runId: 'r' }), runId: 'r' });
  const result = await rebuilt.wait('b1', { pollMs: 0, sleep: async () => {}, observe: async () => { polls += 1; if (polls === 1) throw new Error('temporary_observer_failure'); return { status: 'succeeded', result: { schemaVersion: 1, benchmarkId: 'b1', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', ...passEvidence } }; } });
  assert.equal(result.benchmarkId, 'b1'); assert.equal(polls, 2);
});

test('benchmark join rejects mismatched job or runtime identity', () => {
  const base = { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', ...passEvidence };
  assert.equal(joinBenchmarkResults(base, { ...base }).verdict, 'pass');
  assert.throws(() => joinBenchmarkResults(base, { ...base, job: { remoteJobId: 'other' } }), /identity_mismatch/);
});

test('final acceptance requires throughput and durable evidence for all six restart tracers', () => {
  const base = { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', ...passEvidence };
  const incomplete = evaluateFinalAcceptance({ app: base, qwen: base, restarts: [] }); assert.equal(incomplete.verdict, 'blocked');
  const restarts = REQUIRED_RESTARTS.map((name) => ({ name, verdict: 'pass', artifactId: 'd'.repeat(64), trigger: { predicate: name }, before: { runtimeGeneration: 'before', jobId: 'j' }, after: { runtimeGeneration: 'after', jobId: 'j' } }));
  const complete = evaluateFinalAcceptance({ app: base, qwen: base, restarts }); assert.equal(complete.ok, true);
  assert.equal(evaluateFinalAcceptance({ app: { ...base, metrics: { committedRealtime: 0.49 } }, qwen: base, restarts }).verdict, 'failed');
  assert.equal(evaluateFinalAcceptance({ app: base, qwen: { ...base, metrics: { committedRealtime: 0.49 } }, restarts }).verdict, 'failed');
  assert.equal(evaluateFinalAcceptance({ app: base, qwen: base, restarts: restarts.map((item) => ({ ...item, before: { ...item.before, jobId: 'old' } })) }).missing.length, 6);
  assert.equal(evaluateFinalAcceptance({ app: base, qwen: base, restarts: restarts.map((item) => ({ ...item, after: { ...item.after, runtimeGeneration: item.before.runtimeGeneration } })) }).missing.length, 6);
  assert.equal(evaluateFinalAcceptance({ app: base, qwen: base, restarts: [...restarts, restarts[0]] }).reason, 'restart_matrix_invalid');
  assert.equal(evaluateFinalAcceptance({ app: base, qwen: base, restarts: [...restarts, { ...restarts[0], name: 'unknown-stage' }] }).reason, 'restart_matrix_invalid');
  assert.equal(evaluateFinalAcceptance({ app: base, qwen: base, restarts: restarts.map((item, index) => index === 0 ? { ...item, trigger: { predicate: 'app-after-seal' } } : item) }).missing[0], 'app-during-upload');
});

test('final acceptance recorder persists a correlation event without raw payloads', () => {
  const events = []; const result = recordFinalAcceptance({ store: { append: (event) => events.push(event) }, app: { ...passEvidence, schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass' }, qwen: { ...passEvidence, schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass' }, restarts: [] });
  assert.equal(result.verdict, 'blocked'); assert.equal(events[0].type, 'final_acceptance_evaluated'); assert.equal(events[0].remoteJobId, 'j'); assert.equal('app' in events[0], false);
});

test('final acceptance retains malformed bilateral evidence as a structured blocker', () => {
  const events = []; const result = recordFinalAcceptance({ store: { append: (event) => events.push(event) }, app: null, qwen: null });
  assert.equal(result.ok, false); assert.equal(result.reason, 'benchmark_evidence_invalid'); assert.equal(events[0].type, 'final_acceptance_evaluated'); assert.equal(events[0].verdict, 'blocked');
});
