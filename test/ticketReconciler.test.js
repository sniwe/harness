import assert from 'node:assert/strict';
import test from 'node:test';
import { createTicketReconciler } from '../src/ticketReconciler.js';

test('reconciler runs pending work and observes receipts, not blocked work', async () => {
  const seen = []; const reconciler = createTicketReconciler({ identity: { machineKey: 'machine-b', projectKey: 'main-app' }, client: { list: async () => ({ scannedCount: 3, items: [{ ticketId: 'pending', status: 'pending' }, { ticketId: 'blocked', status: 'blocked' }, { ticketId: 'receipt', kind: 'receipt', status: 'awaiting_ack' }] }) }, log: () => {}, onTicket: async (ticket) => seen.push(`work:${ticket.ticketId}`), onReceipt: async (ticket) => seen.push(`receipt:${ticket.ticketId}`) });
  const result = await reconciler.once(); assert.deepEqual(seen, ['work:pending', 'receipt:receipt']); assert.equal(result.handled, 2);
});
