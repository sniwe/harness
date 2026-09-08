import test from 'node:test';
import assert from 'node:assert/strict';
import { probeRuntime } from '../src/runtimeProbe.js';

test('runtime probe requires an application-level JSON capability response', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, capability: 'audep' }) }); assert.equal((await probeRuntime({ baseUrl: 'http://app', requiredPath: '/capability', required: { capability: 'audep' }, fetchImpl })).state, 'ready');
  const unrelated = await probeRuntime({ baseUrl: 'http://app', requiredPath: '/capability', required: { capability: 'audep' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) }); assert.equal(unrelated.state, 'blocked');
});
