export function createTicketCleanup({ client, journal, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!client || !journal) throw new Error('ticket_cleanup_config_invalid');
  async function remove(ticketId) {
    let result;
    do { try { result = await client.remove(ticketId); } catch (error) { if (error.status === 404) return { missing: true }; throw error; } if (result.inProgress) await sleep(250); } while (result.inProgress);
    return result;
  }
  async function get(ticketId) {
    try { return (await client.get(ticketId)).ticket; } catch (error) { if (error.status === 404) return null; throw error; }
  }
  async function begin(ticket, ticketId, receiptTicketId) {
    if (!ticket) return true;
    if (ticket.status === 'deleting') return true;
    const operationId = `cleanup:${ticketId}`; journal.append({ event: 'mutation_intent', action: 'begin_delete', ticketId, operationId, expectedRevision: ticket.revision });
    try { const result = await client.mutate(ticketId, { operationId, expectedRevision: ticket.revision, previousHash: ticket.headHash, actor: ticket.target, action: 'begin_delete', data: ticketId === receiptTicketId ? {} : { receiptTicketId, outcomeHash: ticket.outcomeHash } }); if (result.ticket?.status !== 'deleting') throw new Error(`cleanup_begin_failed:${ticketId}`); journal.append({ event: 'mutation_result', action: 'begin_delete', ticketId, operationId, outcome: 'deleting' }); return true; } catch (error) { journal.append({ event: 'mutation_result', action: 'begin_delete', ticketId, operationId, outcome: 'error', error: error.message }); throw error; }
  }
  async function cleanupPair(sourceTicketId, receiptTicketId) {
    journal.append({ event: 'cleanup_intent', ticketId: sourceTicketId, receiptTicketId });
    const source = await get(sourceTicketId); await begin(source, sourceTicketId, receiptTicketId); const sourceRemoved = source ? await remove(sourceTicketId) : { missing: true }; journal.append({ event: 'source_cleanup_complete', ticketId: sourceTicketId, deleted: sourceRemoved.deleted === true || sourceRemoved.missing === true });
    const receipt = await get(receiptTicketId); await begin(receipt, receiptTicketId, receiptTicketId); const receiptRemoved = receipt ? await remove(receiptTicketId) : { missing: true }; journal.append({ event: 'ticket_retired', ticketId: sourceTicketId, receiptTicketId, receiptDeleted: receiptRemoved.deleted === true || receiptRemoved.missing === true }); return { sourceDeleted: sourceRemoved.deleted === true || sourceRemoved.missing === true, receiptDeleted: receiptRemoved.deleted === true || receiptRemoved.missing === true };
  }
  async function resumePending(limit = 10) {
    const entries = journal.read(); const retired = new Set(entries.filter((entry) => entry.event === 'ticket_retired').map((entry) => `${entry.ticketId}:${entry.receiptTicketId}`)); const pending = entries.filter((entry) => entry.event === 'cleanup_intent' && !retired.has(`${entry.ticketId}:${entry.receiptTicketId}`)).slice(-limit); const results = []; for (const entry of pending) results.push(await cleanupPair(entry.ticketId, entry.receiptTicketId)); return { attempted: pending.length, results };
  }
  return { cleanupPair, resumePending };
}
