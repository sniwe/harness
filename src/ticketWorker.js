import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ticketPrompt } from './ticketPrompt.js';
import { requireWorkerSuccess } from './workerResult.js';
import { acquireProjectLease } from './projectLease.js';

export function createTicketWorker({ client, pool, identity, log, lockRoot, journal, projectRoot = process.env.MACHINE_BASE_RUNTIME_CWD || process.cwd(), attemptStore, operationOutbox, leaseRoot, now = Date.now, isAlive = (ownerPid) => { try { process.kill(ownerPid, 0); return true; } catch { return false; } } }) {
  if (!client || !pool || !identity || !log || !lockRoot) throw new Error('ticket_worker_config_invalid');
  if (!projectRoot || path.resolve(projectRoot) !== path.resolve(process.env.MACHINE_BASE_RUNTIME_CWD || projectRoot)) throw new Error('ticket_project_cwd_mismatch');
  async function recover() {
    const recovered = [];
    for (const record of attemptStore?.recover?.() || []) {
      if (!record.input?.ticketId) continue;
      const ticketId = record.input.ticketId;
      try {
        const current = (await client.get(ticketId)).ticket;
        if (record.outcome?.state === 'succeeded') {
          const outcomeHash = record.outcome.outcomeHash;
          const leaseToken = record.input.leaseToken;
          if (!outcomeHash || !leaseToken) throw new Error('known_outcome_context_missing');
          const receiptTicketId = crypto.createHash('sha256').update(`receipt/${ticketId}`).digest('hex');
          const receiptOperationId = `receipt:${ticketId}`;
          const receiptPayload = { ticketId: receiptTicketId, operationId: receiptOperationId, kind: 'receipt', sender: identity, target: record.input.sender || current.sender, conversationId: record.input.conversationId || current.conversationId, correlationId: record.input.correlationId || current.correlationId, parentTicketId: ticketId, testRunId: record.input.testRunId || current.testRunId, subject: `Receipt ${ticketId}`, body: 'Ticket completed.', sourceTicketId: ticketId, resultCode: 'success', resultSummary: 'Worker completed.', outcomeHash };
          operationOutbox?.intent(receiptOperationId, { ticketId: receiptTicketId, action: 'create', parentTicketId: ticketId, outcomeHash });
          const receipt = await client.create(receiptPayload);
          operationOutbox?.result(receiptOperationId, { replay: receipt.replay === true, recovered: true });
          if (['claimed', 'in_progress'].includes(current.status)) {
            const completeOperationId = `complete:${ticketId}`;
            const patch = { operationId: completeOperationId, expectedRevision: current.revision, previousHash: current.headHash, actor: identity, action: 'complete', data: { leaseToken, receiptTicketId, outcomeHash } };
            operationOutbox?.intent(completeOperationId, { ticketId, action: 'complete', expectedRevision: current.revision });
            const result = await client.mutate(ticketId, patch);
            operationOutbox?.result(completeOperationId, { revision: result.ticket?.revision, status: result.ticket?.status, recovered: true });
          }
          log({ event: 'execution_recovered_success', ticketId, attemptId: record.input.attemptId });
          recovered.push({ ticketId, attemptId: record.input.attemptId, state: 'succeeded', recovered: true });
          continue;
        }
        if (record.outcome) continue;
        if (['claimed', 'in_progress'].includes(current.status)) {
          const operationId = `recover-block:${ticketId}:${record.input.attemptId}`;
          const patch = { operationId, expectedRevision: current.revision, previousHash: current.headHash, actor: identity, action: 'block', data: { reason: 'unknown_after_crash', attemptId: record.input.attemptId } };
          operationOutbox?.intent(operationId, { ticketId, action: 'block', expectedRevision: current.revision });
          const result = await client.mutate(ticketId, patch);
          operationOutbox?.result(operationId, { revision: result.ticket?.revision, status: result.ticket?.status, recovered: true });
        }
        attemptStore.finish(record.input.attemptId, { state: 'unknown_after_crash', error: 'unknown_after_crash' }); log({ event: 'execution_recovered_unknown', ticketId, attemptId: record.input.attemptId }); recovered.push({ ticketId, attemptId: record.input.attemptId, state: 'unknown_after_crash' });
      } catch (error) { log({ event: 'execution_recovery_failed', ticketId, attemptId: record.input.attemptId, error: error.message }); recovered.push({ ticketId, attemptId: record.input.attemptId, state: 'recovery_failed', error: error.message }); }
    }
    return recovered;
  }
  async function run(ticket) {
    if (journal?.read?.().some((entry) => entry.event === 'ticket_retired' && (entry.ticketId === ticket.ticketId || entry.executionId === `ticket:${ticket.ticketId}`))) { log({ event: 'execution_retired', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` }); return { skipped: true, retired: true }; }
    const key = crypto.createHash('sha256').update(`${identity.machineKey}/${identity.projectKey}/${ticket.ticketId}`).digest('hex'); const file = path.join(lockRoot, `${key}.lock`); fs.mkdirSync(lockRoot, { recursive: true }); let fd;
    const lockOwner = { pid: process.pid, processStart: now(), executionId: `ticket:${ticket.ticketId}`, ticketId: ticket.ticketId };
    try { fd = fs.openSync(file, 'wx'); fs.writeSync(fd, JSON.stringify(lockOwner)); } catch {
      try { const owner = JSON.parse(fs.readFileSync(file, 'utf8')); if (!isAlive(Number(owner.pid), owner, lockOwner.processStart)) throw new Error('owner_dead'); } catch { try { fs.unlinkSync(file); fd = fs.openSync(file, 'wx'); fs.writeSync(fd, JSON.stringify(lockOwner)); } catch {} }
      if (!fd) { log({ event: 'execution_lock_busy', ticketId: ticket.ticketId }); return { skipped: true }; }
    }
    let started = false; let leaseToken; let projectLease; let attempt; const actor = identity;
    const mutate = async (ticketId, operationId, patch) => { operationOutbox?.intent(operationId, { ticketId, action: patch.action, expectedRevision: patch.expectedRevision }); const result = await client.mutate(ticketId, patch); operationOutbox?.result(operationId, { revision: result.ticket?.revision, status: result.ticket?.status }); return result; };
    const create = async (operationId, payload) => { operationOutbox?.intent(operationId, { ticketId: payload.ticketId, action: 'create' }); const result = await client.create(payload); operationOutbox?.result(operationId, { replay: result.replay === true }); return result; };
    try {
      if (leaseRoot) { try { projectLease = acquireProjectLease(leaseRoot, { projectKey: identity.projectKey }); } catch (error) { if (error.message === 'project_lease_busy') { log({ event: 'project_lease_busy', ticketId: ticket.ticketId }); return { skipped: true, projectBusy: true }; } throw error; } }
      leaseToken = crypto.randomUUID(); attempt = attemptStore?.begin({ ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}`, projectKey: identity.projectKey, sender: ticket.sender, conversationId: ticket.conversationId, correlationId: ticket.correlationId, testRunId: ticket.testRunId, leaseToken }); journal?.append({ event: 'execution_intent', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}`, attemptId: attempt?.attemptId }); log({ event: 'execution_intent', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` }); const head = (await client.get(ticket.ticketId)).ticket;
      const claimOperationId = `claim:${ticket.ticketId}`; const claimed = await mutate(ticket.ticketId, claimOperationId, { operationId: claimOperationId, expectedRevision: head.revision, previousHash: head.headHash, actor, action: 'claim', data: { leaseToken } });
      const startOperationId = `start:${ticket.ticketId}`; await mutate(ticket.ticketId, startOperationId, { operationId: startOperationId, expectedRevision: claimed.ticket.revision, previousHash: claimed.ticket.headHash, actor, action: 'start', data: { leaseToken } }); log({ event: 'execution_started', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` }); started = true;
      const result = requireWorkerSuccess(await pool.request({ task: 'remote-prompt', requestId: `ticket:${ticket.ticketId}`, prompt: ticketPrompt(ticket) }), { expectedCwd: projectRoot, expectedProjectKey: identity.projectKey }); const outcomeHash = crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex'); journal?.append({ event: 'execution_outcome', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}`, outcomeHash }); attemptStore?.finish(attempt?.attemptId, { state: 'succeeded', outcomeHash, outcome: result });
      const receiptTicketId = crypto.createHash('sha256').update(`receipt/${ticket.ticketId}`).digest('hex'); const receiptOperationId = `receipt:${ticket.ticketId}`; await create(receiptOperationId, { ticketId: receiptTicketId, operationId: receiptOperationId, kind: 'receipt', sender: actor, target: ticket.sender, conversationId: ticket.conversationId, correlationId: ticket.correlationId, parentTicketId: ticket.ticketId, testRunId: ticket.testRunId, subject: `Receipt ${ticket.ticketId}`, body: 'Ticket completed.', sourceTicketId: ticket.ticketId, resultCode: 'success', resultSummary: 'Worker completed.', outcomeHash });
      const done = (await client.get(ticket.ticketId)).ticket; const completeOperationId = `complete:${ticket.ticketId}`; const final = await mutate(ticket.ticketId, completeOperationId, { operationId: completeOperationId, expectedRevision: done.revision, previousHash: done.headHash, actor, action: 'complete', data: { leaseToken, receiptTicketId, outcomeHash } }); log({ event: 'work_completed', ticketId: ticket.ticketId, executionId: `ticket:${ticket.ticketId}` }); return final;
    } catch (error) { try { attemptStore?.finish(attempt?.attemptId, { state: 'failed', error: error.message }); } catch {} log({ event: 'execution_failed', ticketId: ticket.ticketId, error: error.message }); if (started) { try { const current = await client.get(ticket.ticketId); if (['claimed', 'in_progress'].includes(current.ticket.status)) { const blockOperationId = `block:${ticket.ticketId}`; await mutate(ticket.ticketId, blockOperationId, { operationId: blockOperationId, expectedRevision: current.ticket.revision, previousHash: current.ticket.headHash, actor, action: 'block', data: { reason: 'unknown_after_crash', leaseToken } }); } } catch (blockError) { log({ event: 'block_failed', ticketId: ticket.ticketId, error: blockError.message }); } } throw error;
    } finally {
      try { projectLease?.release(); } catch (error) { log({ event: 'project_lease_release_failed', ticketId: ticket.ticketId, error: error.message }); }
      try { if (fd !== undefined) fs.closeSync(fd); } catch {}
      try { const current = JSON.parse(fs.readFileSync(file, 'utf8')); if (current.pid === lockOwner.pid && current.processStart === lockOwner.processStart) fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') log({ event: 'execution_lock_release_failed', ticketId: ticket.ticketId, error: error.message }); }
    }
  }
  return { run, recover };
}
