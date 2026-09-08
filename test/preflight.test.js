import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeContracts } from '../src/preflight.js';

test('preflight requires the exact advertised Qwen protocol plan', () => {
  const manifest = { protocolBaseline: '12.5s-primary-plus-5s-boundary-v1' }; const ready = { 'qwen-asr': { state: 'ready', body: { runtime: { audep_capabilities: { protocolVersion: 1, plans: [{ planVersion: manifest.protocolBaseline }] } } } } };
  assert.equal(validateRuntimeContracts(manifest, ready), true); assert.equal(validateRuntimeContracts(manifest, { 'qwen-asr': { ...ready['qwen-asr'], body: { runtime: { audep_capabilities: { protocolVersion: 1, plans: [{ planVersion: 'other' }] } } } } }), false); assert.equal(validateRuntimeContracts(manifest, {}), false);
});
