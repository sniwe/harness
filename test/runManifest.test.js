import test from 'node:test';
import assert from 'node:assert/strict';
import { createManifestDigest, validateRunManifest } from '../src/runManifest.js';

test('manifest digest and strict execution shape are validated', () => {
  const manifest = { schemaVersion: 1, runId: 'run-1', planDigest: '', controller: { machineKey: 'machine-base-test' }, inputs: [{ role: 'app-plan', sha256: 'a'.repeat(64) }], handoffMode: 'verified-byte-transfer', protocolBaseline: '12.5s-primary-plus-5s-boundary-v1', projects: { app: { profile: 'C:\\app' } }, limits: { maxCorrectiveAttemptsPerGate: 2, maxConcurrentBenchmarks: 1 }, steps: [{ stepId: 'A0', owner: 'app', dependsOn: [], commandProfile: 'test', verifierProfile: 'focused', immutableInputs: [], resourceBudget: {}, retryClass: 'bounded', requiredOutputTypes: ['evidence'], rollbackProfile: 'preserve', optionalPolicy: 'required' }] };
  manifest.planDigest = createManifestDigest(manifest);
  assert.equal(validateRunManifest(manifest, { verifyInputs: false }).ok, true);
  assert.throws(() => validateRunManifest({ ...manifest, planDigest: 'b'.repeat(64) }, { verifyInputs: false }), /digest_invalid/);
});
