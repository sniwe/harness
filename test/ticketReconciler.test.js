import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
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

test('reconciler resumes its page cursor after reconstruction', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-reconciler-cursor-')); const cursorFile = path.join(root, 'cursor.json'); const queries = []; const pages = [{ items: [], hasMore: true, nextCursor: 'cursor-2' }];
  const first = createTicketReconciler({ identity: { machineKey: 'machine-b', projectKey: 'main-app' }, cursorFile, client: { list: async (query) => { queries.push(query); if (pages.length) return pages.shift(); throw new Error('list_unavailable'); } }, log: () => {} });
  await assert.rejects(() => first.once(), /list_unavailable/); assert.equal(existsSync(cursorFile), true);
  const second = createTicketReconciler({ identity: { machineKey: 'machine-b', projectKey: 'main-app' }, cursorFile, client: { list: async (query) => { queries.push(query); return { items: [], hasMore: false }; } }, log: () => {} });
  await second.once(); assert.equal(queries[1].cursor, 'cursor-2'); assert.equal(existsSync(cursorFile), false);
});

test('reconciler runs maintenance before scanning', async () => {
  const order = []; const reconciler = createTicketReconciler({ identity: { machineKey: 'machine-b', projectKey: 'main-app' }, client: { list: async () => { order.push('list'); return { items: [] }; } }, log: () => {}, onMaintenance: async () => order.push('maintenance') });
  await reconciler.once(); assert.deepEqual(order, ['maintenance', 'list']);
});

test('reconciler continues scanning when maintenance fails', async () => {
  const events = []; const reconciler = createTicketReconciler({ identity: { machineKey: 'machine-b', projectKey: 'main-app' }, client: { list: async () => ({ items: [{ ticketId: 'pending', status: 'pending' }] }) }, log: (event) => events.push(event), onMaintenance: async () => { throw new Error('recovery_unavailable'); }, onTicket: async () => {} });
  const result = await reconciler.once(); assert.equal(result.handled, 1); assert.equal(events[0].event, 'reconcile_maintenance_failed');
});

test('reconciler prevents overlapping scans', async () => {
  let release; const scan = new Promise((resolve) => { release = resolve; }); const reconciler = createTicketReconciler({ identity: { machineKey: 'machine-b', projectKey: 'main-app' }, client: { list: async () => { await scan; return { items: [] }; } }, log: () => {} }); const first = reconciler.once(); await new Promise((resolve) => setImmediate(resolve)); assert.deepEqual(await reconciler.once(), { skipped: true, reason: 'scan_in_progress' }); release(); await first;
});
