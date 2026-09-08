import assert from 'node:assert/strict';
import test from 'node:test';
import { createTicketNotifier } from '../src/ticketNotifier.js';

test('notifier sends only identity and correlation metadata', async () => {
  let sent; const notifier = createTicketNotifier({ peerRequestClient: { send: async (...args) => { sent = args; return { requestId: 'r1' }; } } });
  await notifier.notify({ tunnelKey: 'machine-base-b', ticketId: 'ticket-1', targetMachineKey: 'machine-base-b', targetProjectKey: 'main-app', correlationId: 'corr-1', timeoutMs: 1000 });
  assert.equal(sent[0], 'machine-base-b'); assert.match(sent[1], /ticket-1/); assert.match(sent[1], /main-app/); assert.equal(sent[1].includes('secret task content'), false);
});
