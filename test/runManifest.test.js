import test from 'node:test';
import assert from 'node:assert/strict';
import { createManifestDigest, validateRunManifest } from '../src/runManifest.js';

test('manifest digest and strict execution shape are validated', () => {
  const manifest = { schemaVersion: 1, runId: 'run-1', planDigest: '', controller: { machineKey: 'machine-base-test' }, inputs: [{ role: 'app-plan', sha256: 'a'.repeat(64) }], handoffMode: 'verified-byte-transfer', protocolBaseline: '12.5s-primary-plus-5s-boundary-v1', projects: { 'main-app': { machineKey: 'machine-base-app', profile: 'C:\\app' }, 'qwen-asr': { machineKey: 'machine-base-qwen', profile: 'C:\\qwen' } }, limits: { maxCorrectiveAttemptsPerGate: 2, maxConcurrentBenchmarks: 1 }, steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], commandProfile: 'test', verifierProfile: 'focused', immutableInputs: [], resourceBudget: {}, retryClass: 'bounded', requiredOutputTypes: ['evidence'], rollbackProfile: 'preserve', optionalPolicy: 'required' }] };
  manifest.planDigest = createManifestDigest(manifest);
  assert.equal(validateRunManifest(manifest, { verifyInputs: false }).ok, true);
  assert.throws(() => validateRunManifest({ ...manifest, planDigest: 'b'.repeat(64) }, { verifyInputs: false }), /digest_invalid/);
});

test('manifest rejects invalid dependency graphs before execution', () => {
  const base = { schemaVersion: 1, runId: 'run-graph', controller: { machineKey: 'machine-base-test' }, inputs: [{ role: 'app-plan', sha256: 'a'.repeat(64) }], handoffMode: 'verified-byte-transfer', protocolBaseline: '12.5s-primary-plus-5s-boundary-v1', projects: { 'main-app': { machineKey: 'machine-base-app', profile: 'C:\\app' }, 'qwen-asr': { machineKey: 'machine-base-qwen', profile: 'C:\\qwen' } }, limits: { maxCorrectiveAttemptsPerGate: 1, maxConcurrentBenchmarks: 1 }, steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], commandProfile: 'test', verifierProfile: 'focused', immutableInputs: [], resourceBudget: {}, retryClass: 'bounded', requiredOutputTypes: ['evidence'], rollbackProfile: 'preserve', optionalPolicy: 'required' }, { stepId: 'Q0', owner: 'qwen', dependsOn: ['A0'], commandProfile: 'test', verifierProfile: 'focused', immutableInputs: ['A0'], resourceBudget: {}, retryClass: 'bounded', requiredOutputTypes: ['evidence'], rollbackProfile: 'preserve', optionalPolicy: 'required' }] };
  const check = (steps, error) => { const manifest = { ...base, steps, planDigest: '' }; manifest.planDigest = createManifestDigest(manifest); assert.throws(() => validateRunManifest(manifest, { verifyInputs: false }), error); };
  check([{ ...base.steps[0], stepId: 'A0' }, { ...base.steps[1], stepId: 'A0' }], /step_duplicate/);
  check([{ ...base.steps[0], dependsOn: ['missing'] }, base.steps[1]], /reference_invalid/);
  check([{ ...base.steps[0], dependsOn: ['Q0'] }, base.steps[1]], /cycle/);
});
