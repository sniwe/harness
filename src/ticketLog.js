import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function ticketBodyHash(body) { return crypto.createHash('sha256').update(String(body || ''), 'utf8').digest('hex'); }
export function createTicketLog({ root, machineKey, projectKey, now = () => new Date() } = {}) {
  if (!root || !machineKey || !projectKey) throw new Error('ticket_log_config_invalid');
  function append(event) {
    const date = now().toISOString(); const dir = path.join(root, 'tickets', date.slice(0, 4), date.slice(5, 7), date.slice(8, 10), projectKey); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `tickets-${machineKey}-${projectKey}-${date.slice(0, 10)}.jsonl`); const record = { schemaVersion: 1, eventId: event.eventId || crypto.randomUUID(), eventAt: date, machineKey, projectKey, ...event }; delete record.body; delete record.leaseToken;
    const fd = fs.openSync(file, 'a'); try { fs.writeSync(fd, `${JSON.stringify(record)}\n`, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } return { file, eventId: record.eventId, bodyHash: event.body ? ticketBodyHash(event.body) : null };
  }
  return { append };
}
