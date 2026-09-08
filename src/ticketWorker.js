import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ticketPrompt } from './ticketPrompt.js';
import { requireWorkerSuccess } from './workerResult.js';
import { acquireProjectLease } from './projectLease.js';

export function createTicketWorker({ client, pool, identity, log, lockRoot, journal, projectRoot = process.env.MACHINE_BASE_RUNTIME_CWD || process.cwd(), attemptStore, operationOutbox, leaseRoot }) {
  if (!client || !pool || !identity || !log || !lockRoot) throw new Error('ticket_worker_config_invalid');
  if (!projectRoot || path.resolve(projectRoot) !== path.resolve(process.env.MACHINE_BASE_RUNTIME_CWD || projectRoot)) throw new Error('ticket_project_cwd_mismatch');
  async function run(ticket) {
    if (journal?.read?.().some((entry) => entry.event === 'ticket_retired' && (entry.ticketId === ticket.ticketId || entry.executionId === `ticket:${ticket.ticketId}`))) { log({ event: 'execution_retired', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` }); return { skipped: true, retired: true }; }
    const key = crypto.createHash('sha256').update(`${identity.machineKey}/${identity.projectKey}/${ticket.ticketId}`).digest('hex'); const file = path.join(lockRoot, `${key}.lock`); fs.mkdirSync(lockRoot, { recursive: true }); let fd;
    try { fd = fs.openSync(file, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, executionId: `ticket:${ticket.ticketId}`, ticketId: ticket.ticketId })); } catch {
      try { const owner = JSON.parse(fs.readFileSync(file, 'utf8')); process.kill(owner.pid, 0); } catch { try { fs.unlinkSync(file); fd = fs.openSync(file, 'wx'); fs.writeSync(fd, JSON.stringify({ pid: process.pid, executionId: `ticket:${ticket.ticketId}`, ticketId: ticket.ticketId })); } catch {} }
      if (!fd) { log({ event: 'execution_lock_busy', ticketId: ticket.ticketId }); return { skipped: true }; }
    }
    let started = false; let leaseToken; let projectLease; let attempt; const actor = identity;
    try {
      if (leaseRoot) { try { projectLease = acquireProjectLease(leaseRoot, { projectKey: identity.projectKey }); } catch (error) { if (error.message === 'project_lease_busy') { log({ event: 'project_lease_busy', ticketId: ticket.ticketId }); return { skipped: true, projectBusy: true }; } throw error; } }
      leaseToken = crypto.randomUUID(); attempt = attemptStore?.begin({ ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}`, projectKey: identity.projectKey }); journal?.append({ event: 'execution_intent', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}`, attemptId: attempt?.attemptId }); log({ event: 'execution_intent', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` }); let current = await client.get(ticket.ticketId); const head = current.ticket;
      const claimOperationId = `claim:${ticket.ticketId}`; operationOutbox?.intent(claimOperationId, { ticketId: ticket.ticketId, action: 'claim' }); const claimed = await client.mutate(ticket.ticketId, { operationId: claimOperationId, expectedRevision: head.revision, previousHash: head.headHash, actor, action: 'claim', data: { leaseToken } }); operationOutbox?.result(claimOperationId, { revision: claimed.ticket.revision });
      await client.mutate(ticket.ticketId, { operationId: `start:${ticket.ticketId}`, expectedRevision: claimed.ticket.revision, previousHash: claimed.ticket.headHash, actor, action: 'start', data: { leaseToken } }); log({ event: 'execution_started', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` });
      started = true;
      const result = requireWorkerSuccess(await pool.request({ task: 'remote-prompt', requestId: `ticket:${ticket.ticketId}`, prompt: ticketPrompt(ticket) })); const outcomeHash = crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex'); journal?.append({ event: 'execution_outcome', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}`, outcomeHash }); attemptStore?.finish(attempt?.attemptId, { state: 'succeeded', outcomeHash });
      const receiptTicketId = crypto.createHash('sha256').update(`receipt/${ticket.ticketId}`).digest('hex');
      await client.create({ ticketId: receiptTicketId, operationId: `receipt:${ticket.ticketId}`, kind: 'receipt', sender: actor, target: ticket.sender, conversationId: ticket.conversationId, correlationId: ticket.correlationId, parentTicketId: ticket.ticketId, testRunId: ticket.testRunId, subject: `Receipt ${ticket.ticketId}`, body: 'Ticket completed.', sourceTicketId: ticket.ticketId, resultCode: 'success', resultSummary: 'Worker completed.', outcomeHash });
      const done = await client.get(ticket.ticketId); const final = await client.mutate(ticket.ticketId, { operationId: `complete:${ticket.ticketId}`, expectedRevision: done.ticket.revision, previousHash: done.ticket.headHash, actor, action: 'complete', data: { leaseToken, receiptTicketId, outcomeHash } }); log({ event: 'work_completed', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` }); return final;
    } catch (error) { try { attemptStore?.finish(attempt?.attemptId, { state: 'failed', error: error.message }); } catch {} log({ event: 'execution_failed', ticketId: ticket.ticketId, error: error.message }); if (started) { try { const current = await client.get(ticket.ticketId); if (['claimed', 'in_progress'].includes(current.ticket.status)) await client.mutate(ticket.ticketId, { operationId: `block:${ticket.ticketId}`, expectedRevision: current.ticket.revision, previousHash: current.ticket.headHash, actor, action: 'block', data: { reason: 'unknown_after_crash', leaseToken } }); } catch (blockError) { log({ event: 'block_failed', ticketId: ticket.ticketId, error: blockError.message }); } } throw error; } finally { try { projectLease?.release(); } catch (error) { log({ event: 'project_lease_release_failed', ticketId: ticket.ticketId, error: error.message }); } try { fs.closeSync(fd); } catch {} try { fs.unlinkSync(file); } catch {} }
  }
  return { run };
}
