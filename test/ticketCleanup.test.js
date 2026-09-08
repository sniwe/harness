import assert from 'node:assert/strict';
import test from 'node:test';
import { createTicketCleanup } from '../src/ticketCleanup.js';

test('cleanup journals intent and retires source plus receipt with bounded removal', async () => {
  const states = new Map([['source', { ticketId: 'source', revision: 3, headHash: 'source-head', status: 'completed', target: { machineKey: 'machine-b', projectKey: 'project-b' }, outcomeHash: 'a'.repeat(64) }], ['receipt', { ticketId: 'receipt', revision: 1, headHash: 'receipt-head', status: 'acknowledged', target: { machineKey: 'machine-a', projectKey: 'project-a' } }]]); const calls = []; const removed = new Map(); const journal = { entries: [], append(entry) { this.entries.push(entry); } }; const client = { async get(id) { return { ticket: states.get(id) }; }, async mutate(id, patch) { calls.push({ id, patch }); states.get(id).status = 'deleting'; states.get(id).revision += 1; return { ticket: { status: 'deleting' } }; }, async remove(id) { const count = (removed.get(id) || 0) + 1; removed.set(id, count); return count === 1 ? { inProgress: true } : { deleted: true }; } };
  const result = await createTicketCleanup({ client, journal, sleep: async () => {} }).cleanupPair('source', 'receipt'); assert.deepEqual(result, { sourceDeleted: true, receiptDeleted: true }); assert.deepEqual(calls.map((call) => call.patch.action), ['begin_delete', 'begin_delete']); assert.deepEqual(journal.entries.map((entry) => entry.event), ['cleanup_intent', 'source_cleanup_complete', 'ticket_retired']);
});

test('cleanup resumes when source was already purged', async () => {
  const states = new Map([['receipt', { ticketId: 'receipt', revision: 2, headHash: 'receipt-head', status: 'acknowledged', target: { machineKey: 'machine-a', projectKey: 'project-a' } }]]);
  const calls = []; const journal = { entries: [{ event: 'cleanup_intent', ticketId: 'source', receiptTicketId: 'receipt' }], append(entry) { this.entries.push(entry); }, read() { return this.entries; } };
  const client = { async get(id) { const ticket = states.get(id); if (!ticket) { const error = new Error('missing'); error.status = 404; throw error; } return { ticket }; }, async mutate(id, patch) { calls.push({ id, patch }); states.get(id).status = 'deleting'; return { ticket: { status: 'deleting' } }; }, async remove() { return { deleted: true }; } };
  const result = await createTicketCleanup({ client, journal, sleep: async () => {} }).resumePending();
  assert.deepEqual(result, { attempted: 1, results: [{ sourceDeleted: true, receiptDeleted: true }] });
  assert.deepEqual(calls.map((call) => call.id), ['receipt']);
});
