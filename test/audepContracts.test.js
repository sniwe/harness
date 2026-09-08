import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptAudepSteps, canonicalArtifactName, isExactArtifactMatch } from '../src/audepPlanAdapter.js';
import { validateBenchmarkResult } from '../src/benchmarkSchema.js';

test('AudEp filename aliases are exact and canonicalized', () => {
  assert.equal(canonicalArtifactName('main-app-speed-a5-adaptive-boundary-v2-acceptance.md'), 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md');
  assert.equal(isExactArtifactMatch('main-app-speed-a5-adaptive-boundary-v2-acceptance.md', 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md'), true);
  assert.equal(isExactArtifactMatch('bad-a5-adaptive-boundary-v2-acceptance.md', 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md'), false);
  assert.equal(adaptAudepSteps([{ stepId: 'A6' }])[0].gateId, 'a6-adaptive-v2-acceptance');
});

test('benchmark pass requires browser, localization, and measured throughput evidence', () => {
  const result = { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.wav', durationMs: 1000 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a1', qwenGeneration: 'q1' }, verdict: 'pass', browserEvidence: { normalBrowser: true }, localization: { valid: true }, metrics: { committedRealtime: 0.5 } };
  assert.equal(validateBenchmarkResult(result), true); assert.throws(() => validateBenchmarkResult({ ...result, localization: { valid: false } }), /pass_evidence_invalid/);
});
