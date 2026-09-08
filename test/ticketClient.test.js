import assert from 'node:assert/strict';
import test from 'node:test';
import { createTicketClient } from '../src/ticketClient.js';
import { createTicketLog } from '../src/ticketLog.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('ticket client sends bounded JSON requests and exposes errors', async () => {
  const calls = []; const client = createTicketClient({ baseUrl: 'https://example.test', fetchFn: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) }; } });
  await client.create({ ticketId: 't1' }); assert.equal(calls[0].url, 'https://example.test/_functions/tickets'); assert.equal(JSON.parse(calls[0].options.body).ticketId, 't1');
});

test('ticket log persists metadata without body or lease token', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-log-')); const log = createTicketLog({ root, machineKey: 'machine-base-a', projectKey: 'project' }); const result = log.append({ event: 'created', body: 'secret task', leaseToken: 'secret lease' });
  const line = readFileSync(result.file, 'utf8'); assert.equal(line.includes('secret task'), false); assert.equal(line.includes('secret lease'), false); assert.equal(line.includes(result.bodyHash), false);
});
