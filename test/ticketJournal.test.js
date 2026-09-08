import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createTicketJournal } from '../src/ticketJournal.js';

test('journal preserves complete records and ignores only a torn trailing line', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-journal-')); const file = path.join(root, 'journal.jsonl'); const journal = createTicketJournal(file); journal.append({ event: 'intent', ticketId: 't1' }); fs.appendFileSync(file, '{"event":"torn"'); assert.deepEqual(journal.read(), [{ event: 'intent', ticketId: 't1' }]);
});

test('journal rejects corruption before a trailing record', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-journal-corrupt-')); const file = path.join(root, 'journal.jsonl'); fs.writeFileSync(file, '{bad}\n{"event":"later"}\n'); assert.throws(() => createTicketJournal(file).read(), /journal_corrupt/);
});

test('journal replacement is durable and atomic at the file boundary', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ticket-journal-replace-')); const file = path.join(root, 'journal.jsonl'); const journal = createTicketJournal(file); journal.replace([{ event: 'replaced', ticketId: 't2' }]); assert.deepEqual(journal.read(), [{ event: 'replaced', ticketId: 't2' }]); assert.equal(fs.readdirSync(root).some((name) => name.endsWith('.tmp')), false);
});
