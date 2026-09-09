import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServiceController } from '../src/serviceController.js';
import { commandProfile } from '../src/commandProfiles.js';

test('service controller persists owned process identity and marks missing child unknown', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'service-')); let alive = true; const controller = createServiceController({ file: path.join(root, 'service.json'), spawnImpl: () => ({ pid: 41, unref() {} }), probe: () => alive });
  const started = controller.start({ serviceId: 'bench', command: 'node', cwd: root }); assert.equal(started.pid, 41); assert.equal(controller.inspect().state, 'running'); alive = false; assert.equal(controller.inspect().state, 'unknown'); assert.deepEqual(commandProfile('qwen-benchmark'), {});
});

test('service controller restarts only after its owned child exits', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'service-restart-')); let alive = true; let nextPid = 41; const controller = createServiceController({ file: path.join(root, 'service.json'), spawnImpl: () => ({ pid: ++nextPid, unref() {} }), probe: () => alive });
  controller.start({ serviceId: 'bench', command: 'node', cwd: root }); const restarting = controller.restart({ pollMs: 1 }); await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(controller.inspect().state, 'stopping'); alive = false; const started = await restarting; assert.equal(started.state, 'running'); assert.equal(started.pid, 43);
});

test('service controller fences a reused PID by process start', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'service-pid-reuse-')); let starts = 0; const controller = createServiceController({ file: path.join(root, 'service.json'), now: () => ++starts, spawnImpl: () => ({ pid: 41, unref() {} }), probe: (pid, owner, expectedStart) => pid === 41 && owner.processStart === expectedStart });
  const first = controller.start({ serviceId: 'bench', command: 'node', cwd: root }); assert.equal(first.processStart, 1);
  assert.equal(controller.inspect().state, 'running'); const second = createServiceController({ file: path.join(root, 'service.json'), now: () => 2, spawnImpl: () => ({ pid: 42, unref() {} }), probe: () => false });
  assert.equal(second.start({ serviceId: 'bench', command: 'node', cwd: root }).processStart, 2);
});

test('service controller terminates only its supervised child tree', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'service-supervisor-')); const terminated = []; const owned = new Map(); const supervisor = { own: (pid, metadata) => { owned.set(pid, { pid, ...metadata }); }, list: () => [...owned.values()], terminate: (pid) => { if (!owned.has(pid)) throw new Error('process_not_owned'); terminated.push(pid); owned.delete(pid); } }; let alive = true;
  const controller = createServiceController({ file: path.join(root, 'service.json'), supervisor, spawnImpl: () => ({ pid: 51, unref() {} }), probe: () => alive }); controller.start({ serviceId: 'bench', command: 'node', cwd: root }); controller.stop(); assert.deepEqual(terminated, [51]); alive = false; assert.equal(controller.inspect().state, 'stopped');
});
