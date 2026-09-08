import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createAttemptStore } from '../src/attemptStore.js';
import { createOperationOutbox } from '../src/operationOutbox.js';
import { acquireProjectLease } from '../src/projectLease.js';
import { createProcessSupervisor } from '../src/processSupervisor.js';

test('attempts and operation intents recover after reconstruction', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'durable-')); const attempts = createAttemptStore(root); const attempt = attempts.begin({ phaseId: 'A0', stepId: 'A0', operationId: 'op-1' }); attempts.finish(attempt.attemptId, { state: 'succeeded', output: 'retained' }); assert.equal(attempts.recover()[0].outcome.output, 'retained');
  const outbox = createOperationOutbox(root); outbox.intent('op-1', { action: 'claim' }); assert.equal(outbox.pending().length, 1); outbox.result('op-1', { status: 200 }); assert.equal(outbox.pending().length, 0); assert.ok(fs.existsSync(path.join(root, 'operations', 'op-1.json')));
});

test('project lease excludes a second owner and releases only its owner', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lease-')); const lease = acquireProjectLease(root, { projectKey: 'app', pid: 11, now: 22 }); assert.throws(() => acquireProjectLease(root, { projectKey: 'app', pid: 12, now: 23 }), /lease_busy/); lease.release(); assert.equal(acquireProjectLease(root, { projectKey: 'app', pid: 12, now: 23 }).lease.pid, 12);
});

test('process supervisor only terminates owned children', () => { const killed = []; const supervisor = createProcessSupervisor({ kill: (pid) => killed.push(pid) }); supervisor.own(7, { attemptId: 'a' }); assert.throws(() => supervisor.terminate(8), /not_owned/); supervisor.terminate(7); assert.deepEqual(killed, [7]); });
