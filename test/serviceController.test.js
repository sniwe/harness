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
