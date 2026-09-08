import test from 'node:test';
import assert from 'node:assert/strict';
import { probeRuntime, waitForRuntime } from '../src/runtimeProbe.js';

test('runtime probe requires an application-level JSON capability response', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, capability: 'audep' }) }); assert.equal((await probeRuntime({ baseUrl: 'http://app', requiredPath: '/capability', required: { capability: 'audep' }, fetchImpl })).state, 'ready');
  const unrelated = await probeRuntime({ baseUrl: 'http://app', requiredPath: '/capability', required: { capability: 'audep' }, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }) }); assert.equal(unrelated.state, 'blocked');
});

test('runtime readiness waits persistently and supports cancellation', async () => {
  let polls = 0; const ready = await waitForRuntime({}, { probe: async () => (++polls < 2 ? { state: 'blocked' } : { state: 'ready' }), sleep: async () => {} });
  assert.equal(ready.state, 'ready'); assert.equal(polls, 2);
  const controller = new AbortController(); controller.abort(); await assert.rejects(() => waitForRuntime({}, { probe: async () => ({ state: 'blocked' }), signal: controller.signal }), /runtime_wait_cancelled/);
});
