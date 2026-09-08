import assert from 'node:assert/strict';
import test from 'node:test';
import { createTicketReconciler } from '../src/ticketReconciler.js';

test('reconciler runs pending work and observes receipts, not blocked work', async () => {
  const seen = []; const reconciler = createTicketReconciler({ identity: { machineKey: 'machine-b', projectKey: 'main-app' }, client: { list: async () => ({ scannedCount: 3, items: [{ ticketId: 'pending', status: 'pending' }, { ticketId: 'blocked', status: 'blocked' }, { ticketId: 'receipt', kind: 'receipt', status: 'awaiting_ack' }] }) }, log: () => {}, onTicket: async (ticket) => seen.push(`work:${ticket.ticketId}`), onReceipt: async (ticket) => seen.push(`receipt:${ticket.ticketId}`) });
  const result = await reconciler.once(); assert.deepEqual(seen, ['work:pending', 'receipt:receipt']); assert.equal(result.handled, 2);
});

test('reconciler follows bounded list cursors', async () => {
  const queries = []; const seen = []; const pages = [{ scannedCount: 100, items: [{ ticketId: 'first', status: 'blocked' }], hasMore: true, nextCursor: 'cursor-1' }, { scannedCount: 2, items: [{ ticketId: 'second', status: 'pending' }], hasMore: false, nextCursor: null }];
  const reconciler = createTicketReconciler({ identity: { machineKey: 'machine-b', projectKey: 'main-app' }, client: { list: async (query) => { queries.push(query); return pages.shift(); } }, log: () => {}, onTicket: async (ticket) => seen.push(ticket.ticketId) });
  const result = await reconciler.once(); assert.deepEqual(queries, [{ targetMachineKey: 'machine-b', targetProjectKey: 'main-app', limit: '100' }, { targetMachineKey: 'machine-b', targetProjectKey: 'main-app', limit: '100', cursor: 'cursor-1' }]); assert.deepEqual(seen, ['second']); assert.equal(result.scannedCount, 102); assert.equal(result.hasMore, false);
});

test('reconciler runs maintenance before scanning', async () => {
  const order = []; const reconciler = createTicketReconciler({ identity: { machineKey: 'machine-b', projectKey: 'main-app' }, client: { list: async () => { order.push('list'); return { items: [] }; } }, log: () => {}, onMaintenance: async () => order.push('maintenance') });
  await reconciler.once(); assert.deepEqual(order, ['maintenance', 'list']);
});
