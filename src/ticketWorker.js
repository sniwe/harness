import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ticketPrompt } from './ticketPrompt.js';

export function createTicketWorker({ client, pool, identity, log, lockRoot, projectRoot = process.env.MACHINE_BASE_RUNTIME_CWD || process.cwd() }) {
  if (!client || !pool || !identity || !log || !lockRoot) throw new Error('ticket_worker_config_invalid');
  if (!projectRoot || path.resolve(projectRoot) !== path.resolve(process.env.MACHINE_BASE_RUNTIME_CWD || projectRoot)) throw new Error('ticket_project_cwd_mismatch');
  async function run(ticket) {
    const key = crypto.createHash('sha256').update(`${identity.machineKey}/${identity.projectKey}/${ticket.ticketId}`).digest('hex'); const file = path.join(lockRoot, `${key}.lock`); fs.mkdirSync(lockRoot, { recursive: true }); let fd;
    try { fd = fs.openSync(file, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, executionId: `ticket:${ticket.ticketId}`, ticketId: ticket.ticketId })); } catch {
      try { const owner = JSON.parse(fs.readFileSync(file, 'utf8')); process.kill(owner.pid, 0); } catch { try { fs.unlinkSync(file); fd = fs.openSync(file, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, executionId: `ticket:${ticket.ticketId}`, ticketId: ticket.ticketId })); } catch {} }
      if (!fd) { log({ event: 'execution_lock_busy', ticketId: ticket.ticketId }); return { skipped: true }; }
    }
    try {
      const leaseToken = crypto.randomUUID(); const actor = identity; let current = await client.get(ticket.ticketId); const head = current.ticket;
      const claimed = await client.mutate(ticket.ticketId, { operationId: `claim:${ticket.ticketId}`, expectedRevision: head.revision, previousHash: head.headHash, actor, action: 'claim', data: { leaseToken } });
      await client.mutate(ticket.ticketId, { operationId: `start:${ticket.ticketId}`, expectedRevision: claimed.ticket.revision, previousHash: claimed.ticket.headHash, actor, action: 'start', data: { leaseToken } }); log({ event: 'execution_started', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` });
      const result = await pool.request({ task: 'remote-prompt', requestId: `ticket:${ticket.ticketId}`, prompt: ticketPrompt(ticket) }); const outcomeHash = crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
      const receiptTicketId = crypto.createHash('sha256').update(`receipt/${ticket.ticketId}`).digest('hex');
      await client.create({ ticketId: receiptTicketId, operationId: `receipt:${ticket.ticketId}`, kind: 'receipt', sender: actor, target: ticket.sender, conversationId: ticket.conversationId, correlationId: ticket.correlationId, parentTicketId: ticket.ticketId, testRunId: ticket.testRunId, subject: `Receipt ${ticket.ticketId}`, body: 'Ticket completed.', sourceTicketId: ticket.ticketId, resultCode: 'success', resultSummary: 'Worker completed.', outcomeHash });
      const done = await client.get(ticket.ticketId); const final = await client.mutate(ticket.ticketId, { operationId: `complete:${ticket.ticketId}`, expectedRevision: done.ticket.revision, previousHash: done.ticket.headHash, actor, action: 'complete', data: { leaseToken, receiptTicketId, outcomeHash } }); log({ event: 'work_completed', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` }); return final;
    } catch (error) { log({ event: 'execution_failed', ticketId: ticket.ticketId, error: error.message }); throw error; } finally { try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(file); } catch {} }
  }
  return { run };
}
