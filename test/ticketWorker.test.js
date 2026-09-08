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
