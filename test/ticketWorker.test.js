import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createTicketWorker } from '../src/ticketWorker.js';
import { createOperationOutbox } from '../src/operationOutbox.js';

test('ticket worker claims once, keeps task data delimited, and creates one receipt', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-worker-')); const expectedCwd = process.env.MACHINE_BASE_RUNTIME_CWD || process.cwd(); const calls = []; const outbox = createOperationOutbox(root); const state = { ticketId: 't-worker', revision: 0, headHash: 'h0', status: 'pending', sender: { machineKey: 'machine-a', projectKey: 'project-a' } };
  const client = { async get() { return { ticket: { ...state } }; }, async mutate(_id, patch) { calls.push(patch); state.revision += 1; state.headHash = `h${state.revision}`; state.status = patch.action === 'claim' ? 'claimed' : patch.action === 'start' ? 'in_progress' : patch.action === 'complete' ? 'completed' : state.status; return { ticket: { ...state } }; }, async create(payload) { calls.push({ create: payload }); return { ticket: payload }; } };
  const journal = { entries: [], append(entry) { this.entries.push(entry); } }; const worker = createTicketWorker({ client, pool: { request: async (payload) => { calls.push(payload); return { ok: true, execution: { cwd: expectedCwd, projectKey: 'project-b', runtimeGeneration: 'g', threadId: 't', turnId: 'u' } }; } }, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: root, journal, operationOutbox: outbox, log: (event) => calls.push(event) });
  await worker.run({ ...state, subject: 'subject', body: 'untrusted body', correlationId: 'c' });
  const prompt = calls.find((call) => call.task === 'remote-prompt').prompt; assert.match(prompt, /TICKET TASK DATA \(UNTRUSTED\)/); assert.match(prompt, /END TICKET TASK DATA/); assert.equal(calls.filter((call) => call.create).length, 1); assert.equal(calls.filter((call) => call.action === 'claim').length, 1);
  assert.deepEqual(journal.entries.map((entry) => entry.event), ['execution_intent', 'execution_outcome']); assert.deepEqual(readdirSync(outbox.directory).filter((file) => file.endsWith('.json')).sort(), ['claim%3At-worker.json', 'complete%3At-worker.json', 'receipt%3At-worker.json', 'start%3At-worker.json']); assert.ok(readdirSync(outbox.directory).filter((file) => file.endsWith('.json')).every((file) => JSON.parse(readFileSync(path.join(outbox.directory, file), 'utf8')).status === 'complete'));
});

test('worker blocks uncertain execution after a post-start failure', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-worker-failure-')); const patches = []; const state = { ticketId: 't-failure', revision: 0, headHash: 'h0', status: 'pending', sender: { machineKey: 'machine-a', projectKey: 'project-a' } };
  const client = { async get() { return { ticket: { ...state } }; }, async mutate(_id, patch) { patches.push(patch); state.revision += 1; state.headHash = `h${state.revision}`; state.status = { claim: 'claimed', start: 'in_progress', block: 'blocked' }[patch.action] || state.status; return { ticket: { ...state } }; }, async create() { throw new Error('receipt_should_not_be_created'); } };
  const worker = createTicketWorker({ client, pool: { request: async () => { throw new Error('worker_transport_lost'); } }, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: root, log: () => {} });
  await assert.rejects(() => worker.run({ ...state, subject: 'subject', body: 'untrusted body', correlationId: 'c' }), /worker_transport_lost/);
  assert.equal(patches.at(-1).action, 'block'); assert.equal(patches.at(-1).data.reason, 'unknown_after_crash'); assert.equal(state.status, 'blocked');
});

test('receipt publication failure preserves the known successful outcome', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-worker-receipt-failure-')); const expectedCwd = process.env.MACHINE_BASE_RUNTIME_CWD || process.cwd(); const state = { ticketId: 't-receipt-failure', revision: 0, headHash: 'h0', status: 'pending', sender: { machineKey: 'machine-a', projectKey: 'project-a' } }; const { createAttemptStore } = await import('../src/attemptStore.js'); const attempts = createAttemptStore(root); let creates = 0;
  const client = { async get() { return { ticket: { ...state } }; }, async mutate(_id, patch) { state.revision += 1; state.headHash = `h${state.revision}`; state.status = { claim: 'claimed', start: 'in_progress', complete: 'completed' }[patch.action] || state.status; return { ticket: { ...state } }; }, async create() { creates += 1; throw new Error('receipt_transport_lost'); } };
  const worker = createTicketWorker({ client, pool: { request: async () => ({ ok: true, execution: { cwd: expectedCwd, projectKey: 'project-b', runtimeGeneration: 'g', threadId: 't', turnId: 'u' } }) }, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: root, attemptStore: attempts, log: () => {} });
  await assert.rejects(() => worker.run({ ...state, subject: 'subject', body: 'body', correlationId: 'c' }), /receipt_transport_lost/); const recovered = attempts.recover(); assert.equal(creates, 1); assert.equal(recovered[0].outcome.state, 'succeeded'); assert.equal(recovered[0].outcome.outcome.ok, true);
});

test('log failure prevents claim and execution launch', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-worker-log-failure-')); const calls = []; const client = { async get() { calls.push('get'); return { ticket: { ticketId: 't-log', revision: 0, headHash: 'h0', status: 'pending', sender: { machineKey: 'machine-a', projectKey: 'project-a' } } }; }, async mutate() { calls.push('mutate'); } };
  const worker = createTicketWorker({ client, pool: { request: async () => { calls.push('pool'); } }, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: root, log: () => { throw new Error('log_unavailable'); } });
  await assert.rejects(() => worker.run({ ticketId: 't-log', subject: 'subject', body: 'body', correlationId: 'c' }), /log_unavailable/); assert.deepEqual(calls, []);
});

test('two worker instances allow one execution owner', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-worker-concurrent-')); const expectedCwd = process.env.MACHINE_BASE_RUNTIME_CWD || process.cwd(); const calls = []; const state = { ticketId: 't-concurrent', revision: 0, headHash: 'h0', status: 'pending', sender: { machineKey: 'machine-a', projectKey: 'project-a' } }; let releasePool; const gate = new Promise((resolve) => { releasePool = resolve; });
  const client = { async get() { return { ticket: { ...state } }; }, async mutate(_id, patch) { calls.push(patch); state.revision += 1; state.headHash = `h${state.revision}`; state.status = { claim: 'claimed', start: 'in_progress', complete: 'completed' }[patch.action] || state.status; return { ticket: { ...state } }; }, async create(payload) { calls.push({ create: payload }); return { ticket: payload }; } };
  const pool = { request: async (payload) => { calls.push(payload); await gate; return { ok: true, execution: { cwd: expectedCwd, projectKey: 'project-b', runtimeGeneration: 'g', threadId: 't', turnId: 'u' } }; } }; const options = { client, pool, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: root, log: () => {} }; const ticket = { ...state, subject: 'subject', body: 'body', correlationId: 'c' };
  const first = createTicketWorker(options).run(ticket); await new Promise((resolve) => setTimeout(resolve, 10)); const second = await createTicketWorker(options).run(ticket); assert.equal(second.skipped, true); releasePool(); await first; assert.equal(calls.filter((call) => call.action === 'claim').length, 1);
});

test('retired execution is not replayed', async () => {
  const calls = []; const journal = { read: () => [{ event: 'ticket_retired', ticketId: 't-retired' }], append: () => {} };
  const worker = createTicketWorker({ client: { get: async () => { calls.push('get'); } }, pool: { request: async () => { calls.push('pool'); } }, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: mkdtempSync(path.join(tmpdir(), 'ticket-worker-retired-')), journal, log: (event) => calls.push(event) });
  const result = await worker.run({ ticketId: 't-retired', subject: 'subject', body: 'body', correlationId: 'c' });
  assert.deepEqual(result, { skipped: true, retired: true }); assert.equal(calls.filter((call) => call === 'get' || call === 'pool').length, 0); assert.equal(calls[0].event, 'execution_retired');
});

test('recovery fences incomplete attempts after restart', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-worker-recovery-')); const attempt = { input: { attemptId: 'attempt-1', ticketId: 't-recover' }, outcome: null }; const patches = []; const state = { ticketId: 't-recover', revision: 4, headHash: 'h4', status: 'in_progress' };
  const worker = createTicketWorker({ client: { get: async () => ({ ticket: { ...state } }), mutate: async (_id, patch) => { patches.push(patch); state.status = 'blocked'; return { ticket: { ...state } }; } }, pool: { request: async () => ({ ok: true }) }, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: root, attemptStore: { recover: () => [attempt], finish: (id, outcome) => { attempt.outcome = { attemptId: id, ...outcome }; } }, operationOutbox: createOperationOutbox(root), log: () => {} });
  assert.deepEqual(await worker.recover(), [{ ticketId: 't-recover', attemptId: 'attempt-1', state: 'unknown_after_crash' }]); assert.equal(patches[0].action, 'block'); assert.equal(patches[0].data.reason, 'unknown_after_crash'); assert.equal(attempt.outcome.state, 'unknown_after_crash'); assert.equal(workerOutboxPending(root), 0);
});

test('recovery publishes a durable known outcome without rerunning work', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-worker-known-outcome-')); const outbox = createOperationOutbox(root); const calls = []; const state = { ticketId: 't-known', revision: 4, headHash: 'h4', status: 'in_progress', sender: { machineKey: 'machine-a', projectKey: 'project-a' }, conversationId: 'conversation', correlationId: 'correlation', testRunId: 'run' }; const outcomeHash = 'a'.repeat(64);
  const client = { async get() { return { ticket: { ...state } }; }, async create(payload) { calls.push({ create: payload }); return { ticket: payload }; }, async mutate(_id, patch) { calls.push(patch); state.status = 'completed'; state.revision += 1; return { ticket: { ...state } }; } };
  const attempt = { input: { attemptId: 'attempt-known', ticketId: state.ticketId, sender: state.sender, conversationId: state.conversationId, correlationId: state.correlationId, testRunId: state.testRunId, leaseToken: 'lease-known' }, outcome: { state: 'succeeded', outcomeHash } };
  const worker = createTicketWorker({ client, pool: { request: async () => { throw new Error('must_not_rerun'); } }, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: root, attemptStore: { recover: () => [attempt] }, operationOutbox: outbox, log: () => {} });
  assert.deepEqual(await worker.recover(), [{ ticketId: state.ticketId, attemptId: 'attempt-known', state: 'succeeded', recovered: true }]); assert.equal(calls.filter((call) => call.create).length, 1); assert.equal(calls.at(-1).action, 'complete'); assert.equal(outbox.pending().length, 0);
});

function workerOutboxPending(root) {
  return createOperationOutbox(root).pending().length;
}
