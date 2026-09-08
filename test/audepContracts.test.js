import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptAudepSteps, canonicalArtifactName, isExactArtifactMatch } from '../src/audepPlanAdapter.js';
import { validateBenchmarkResult } from '../src/benchmarkSchema.js';
import { joinBenchmarkResults } from '../src/benchmarkJoin.js';
import { evaluateFinalAcceptance, REQUIRED_RESTARTS } from '../src/finalAcceptance.js';
import { validateHandoff } from '../src/handoffSchemas.js';
import { createBenchmarkCoordinator } from '../src/benchmarkCoordinator.js';
import { createRunStore } from '../src/runStore.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('AudEp filename aliases are exact and canonicalized', () => {
  assert.equal(canonicalArtifactName('main-app-speed-a5-adaptive-boundary-v2-acceptance.md'), 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md');
  assert.equal(isExactArtifactMatch('main-app-speed-a5-adaptive-boundary-v2-acceptance.md', 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md'), true);
  assert.equal(isExactArtifactMatch('bad-a5-adaptive-boundary-v2-acceptance.md', 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md'), false);
  assert.equal(adaptAudepSteps([{ stepId: 'A6' }])[0].gateId, 'a6-adaptive-v2-acceptance');
});

test('handoff filenames cannot escape the receiving directory', () => {
  const descriptor = { schemaVersion: 1, runId: 'r', artifactType: 'x', producerPhase: 'Q1', producer: { machineKey: 'q', projectKey: 'qwen-asr' }, consumer: { machineKey: 'a', projectKey: 'main-app' }, filename: 'x.md', requiredAcceptanceType: 'x', artifact: { sha256: 'a'.repeat(64), byteLength: 1 } };
  assert.equal(validateHandoff(descriptor), true);
  assert.throws(() => validateHandoff({ ...descriptor, filename: '../x.md' }), /filename_invalid/);
  assert.throws(() => validateHandoff({ ...descriptor, filename: 'nested/x.md' }), /filename_invalid/);
});

test('benchmark pass requires browser, localization, and measured throughput evidence', () => {
  const result = { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', browserEvidence: { normalBrowser: true }, localization: { valid: true }, metrics: { committedRealtime: 0.5 } };
  assert.equal(validateBenchmarkResult(result), true); assert.throws(() => validateBenchmarkResult({ ...result, localization: { valid: false } }), /pass_evidence_invalid/);
});

test('benchmark execution identity and running state survive coordinator reconstruction', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'benchmark-')); const runStore = createRunStore({ root, runId: 'r' }); const base = { schemaVersion: 1, runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', browserEvidence: { normalBrowser: true }, localization: { valid: true }, metrics: { committedRealtime: 0.5 } }; let release; const pending = new Promise((resolve) => { release = resolve; }); const first = createBenchmarkCoordinator({ store: runStore, runId: 'r' }); const running = first.execute({}, async ({ benchmarkId }) => { await pending; return { ...base, benchmarkId }; }, { benchmarkId: 'b1' }); while (first.active !== 1) await new Promise((resolve) => setTimeout(resolve, 1)); const rebuilt = createBenchmarkCoordinator({ store: createRunStore({ root, runId: 'r' }), runId: 'r' }); assert.equal(rebuilt.inspect('b1').status, 'running'); assert.equal(rebuilt.active, 1); release(); await running; assert.equal(rebuilt.inspect('b1').status, 'succeeded');
});

test('benchmark join rejects mismatched job or runtime identity', () => {
  const base = { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', browserEvidence: { normalBrowser: true }, localization: { valid: true }, metrics: { committedRealtime: 0.5 } };
  assert.equal(joinBenchmarkResults(base, { ...base }).verdict, 'pass');
  assert.throws(() => joinBenchmarkResults(base, { ...base, job: { remoteJobId: 'other' } }), /identity_mismatch/);
});

test('final acceptance requires throughput and all six restart tracers', () => {
  const base = { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', browserEvidence: { normalBrowser: true }, localization: { valid: true }, metrics: { committedRealtime: 0.5 } };
  const incomplete = evaluateFinalAcceptance({ app: base, qwen: base, restarts: [] }); assert.equal(incomplete.verdict, 'blocked');
  const complete = evaluateFinalAcceptance({ app: base, qwen: base, restarts: REQUIRED_RESTARTS.map((name) => ({ name, verdict: 'pass' })) }); assert.equal(complete.ok, true);
  assert.equal(evaluateFinalAcceptance({ app: { ...base, metrics: { committedRealtime: 0.49 } }, qwen: base, restarts: REQUIRED_RESTARTS.map((name) => ({ name, verdict: 'pass' })) }).verdict, 'failed');
});
