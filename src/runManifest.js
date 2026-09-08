import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const HASH = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function readRunManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateRunManifest(manifest);
  return manifest;
}

export function validateRunManifest(manifest, { verifyInputs = true } = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || !KEY.test(manifest.runId || '') || !Array.isArray(manifest.inputs) || !manifest.inputs.length || !Array.isArray(manifest.steps) || !manifest.steps.length) throw new Error('run_manifest_invalid');
  if (manifest.handoffMode !== 'verified-byte-transfer' || manifest.protocolBaseline !== '12.5s-primary-plus-5s-boundary-v1') throw new Error('run_manifest_contract_invalid');
  if (!manifest.controller?.machineKey || !manifest.projects || !Number.isInteger(manifest.limits?.maxCorrectiveAttemptsPerGate) || !Number.isInteger(manifest.limits?.maxConcurrentBenchmarks)) throw new Error('run_manifest_policy_invalid');
  for (const input of manifest.inputs) {
    if (!KEY.test(input.role || '') || !HASH.test(input.sha256 || '') || (verifyInputs && input.path && sha256File(input.path) !== input.sha256)) throw new Error(`run_manifest_input_invalid:${input.role || 'unknown'}`);
  }
  for (const step of manifest.steps) if (!KEY.test(step.stepId || '') || !step.owner || !Array.isArray(step.dependsOn) || !step.commandProfile || !step.verifierProfile || !Array.isArray(step.immutableInputs) || !step.resourceBudget || !step.retryClass || !Array.isArray(step.requiredOutputTypes) || !step.rollbackProfile || !step.optionalPolicy) throw new Error(`run_manifest_step_invalid:${step.stepId || 'unknown'}`);
  const digest = crypto.createHash('sha256').update(JSON.stringify({ ...manifest, planDigest: undefined })).digest('hex');
  if (manifest.planDigest !== digest) throw new Error('run_manifest_digest_invalid');
  return { ok: true, runId: manifest.runId, planDigest: digest, steps: manifest.steps.length };
}

export function createManifestDigest(manifest) {
  return crypto.createHash('sha256').update(JSON.stringify({ ...manifest, planDigest: undefined })).digest('hex');
}

export function resolveManifestPath(value) { return path.resolve(String(value || '')); }
