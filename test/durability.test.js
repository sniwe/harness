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

test('attempt identities are contained and durable writes are complete JSON records', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'attempt-safe-')); const attempts = createAttemptStore(root); assert.throws(() => attempts.begin({ attemptId: '../escape' }), /attempt_id_invalid/); const attempt = attempts.begin({ attemptId: 'a-safe' }); const outcome = attempts.finish(attempt.attemptId, { state: 'failed', error: 'worker_failed' }); assert.equal(outcome.attemptId, 'a-safe'); assert.match(fs.readFileSync(path.join(root, 'attempts', 'a-safe', 'outcome.json'), 'utf8'), /worker_failed/);
});

test('operation identities are contained and outbox records are atomically persisted', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'operation-safe-')); const outbox = createOperationOutbox(root); assert.throws(() => outbox.intent('../escape', { action: 'claim' }), /operation_id_invalid/); outbox.intent('op-safe', { action: 'claim' }); assert.throws(() => outbox.intent('op-safe', { action: 'complete' }), /operation_id_reuse_conflict/); const complete = outbox.result('op-safe', { status: 200 }); assert.equal(complete.status, 'complete'); assert.match(fs.readFileSync(path.join(root, 'operations', 'op-safe.json'), 'utf8'), /"complete"/);
});

test('project lease excludes a second owner and releases only its owner', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lease-')); const lease = acquireProjectLease(root, { projectKey: 'app', pid: 11, now: 22, isAlive: () => true }); assert.throws(() => acquireProjectLease(root, { projectKey: 'app', pid: 12, now: 23, isAlive: () => true }), /lease_busy/); lease.release(); assert.equal(acquireProjectLease(root, { projectKey: 'app', pid: 12, now: 23 }).lease.pid, 12);
});

test('project lease recovers only a lease whose owner is dead', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lease-recover-')); const first = acquireProjectLease(root, { projectKey: 'app', pid: 11, now: 22, isAlive: () => true }); assert.throws(() => acquireProjectLease(root, { projectKey: 'app', pid: 12, now: 23, isAlive: () => true }), /lease_busy/); first.release();
  const stale = path.join(root, 'app.lease'); fs.writeFileSync(stale, JSON.stringify({ pid: 99 })); const recovered = acquireProjectLease(root, { projectKey: 'app', pid: 12, now: 23, isAlive: (pid) => pid !== 99 }); assert.equal(recovered.lease.pid, 12); recovered.release();
});

test('process supervisor only terminates owned children', () => { const killed = []; const supervisor = createProcessSupervisor({ kill: (pid) => killed.push(pid) }); supervisor.own(7, { attemptId: 'a' }); assert.throws(() => supervisor.terminate(8), /not_owned/); supervisor.terminate(7); assert.deepEqual(killed, [7]); });
