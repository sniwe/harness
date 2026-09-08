import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createTicketWorker } from '../src/ticketWorker.js';

test('ticket worker claims once, keeps task data delimited, and creates one receipt', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-worker-')); const calls = []; const state = { ticketId: 't-worker', revision: 0, headHash: 'h0', status: 'pending', sender: { machineKey: 'machine-a', projectKey: 'project-a' } };
  const client = { async get() { return { ticket: { ...state } }; }, async mutate(_id, patch) { calls.push(patch); state.revision += 1; state.headHash = `h${state.revision}`; state.status = patch.action === 'claim' ? 'claimed' : patch.action === 'start' ? 'in_progress' : patch.action === 'complete' ? 'completed' : state.status; return { ticket: { ...state } }; }, async create(payload) { calls.push({ create: payload }); return { ticket: payload }; } };
  const worker = createTicketWorker({ client, pool: { request: async (payload) => { calls.push(payload); return { ok: true }; } }, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: root, log: (event) => calls.push(event) });
  await worker.run({ ...state, subject: 'subject', body: 'untrusted body', correlationId: 'c' });
  const prompt = calls.find((call) => call.task === 'remote-prompt').prompt; assert.match(prompt, /TICKET TASK DATA \(UNTRUSTED\)/); assert.match(prompt, /END TICKET TASK DATA/); assert.equal(calls.filter((call) => call.create).length, 1); assert.equal(calls.filter((call) => call.action === 'claim').length, 1);
});

test('worker blocks uncertain execution after a post-start failure', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-worker-failure-')); const patches = []; const state = { ticketId: 't-failure', revision: 0, headHash: 'h0', status: 'pending', sender: { machineKey: 'machine-a', projectKey: 'project-a' } };
  const client = { async get() { return { ticket: { ...state } }; }, async mutate(_id, patch) { patches.push(patch); state.revision += 1; state.headHash = `h${state.revision}`; state.status = { claim: 'claimed', start: 'in_progress', block: 'blocked' }[patch.action] || state.status; return { ticket: { ...state } }; }, async create() { throw new Error('receipt_should_not_be_created'); } };
  const worker = createTicketWorker({ client, pool: { request: async () => { throw new Error('worker_transport_lost'); } }, identity: { machineKey: 'machine-b', projectKey: 'project-b' }, lockRoot: root, log: () => {} });
  await assert.rejects(() => worker.run({ ...state, subject: 'subject', body: 'untrusted body', correlationId: 'c' }), /worker_transport_lost/);
  assert.equal(patches.at(-1).action, 'block'); assert.equal(patches.at(-1).data.reason, 'unknown_after_crash'); assert.equal(state.status, 'blocked');
});
