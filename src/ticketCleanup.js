export function createTicketCleanup({ client, journal, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!client || !journal) throw new Error('ticket_cleanup_config_invalid');
  async function remove(ticketId) {
    let result;
    do { try { result = await client.remove(ticketId); } catch (error) { if (error.status === 404) return { missing: true }; throw error; } if (result.inProgress) await sleep(250); } while (result.inProgress);
    return result;
  }
  async function cleanupPair(sourceTicketId, receiptTicketId) {
    const source = await client.get(sourceTicketId); journal.append({ event: 'cleanup_intent', ticketId: sourceTicketId, receiptTicketId });
    const sourceBegin = await client.mutate(sourceTicketId, { operationId: `cleanup:${sourceTicketId}`, expectedRevision: source.ticket.revision, previousHash: source.ticket.headHash, actor: source.ticket.target, action: 'begin_delete', data: { receiptTicketId, outcomeHash: source.ticket.outcomeHash } });
    if (sourceBegin.ticket?.status !== 'deleting') throw new Error(`cleanup_begin_failed:${sourceTicketId}`); const sourceRemoved = await remove(sourceTicketId); journal.append({ event: 'source_cleanup_complete', ticketId: sourceTicketId, deleted: sourceRemoved.deleted === true || sourceRemoved.missing === true });
    const receipt = await client.get(receiptTicketId); const receiptBegin = await client.mutate(receiptTicketId, { operationId: `cleanup:${receiptTicketId}`, expectedRevision: receipt.ticket.revision, previousHash: receipt.ticket.headHash, actor: receipt.ticket.target, action: 'begin_delete', data: {} });
    if (receiptBegin.ticket?.status !== 'deleting') throw new Error(`cleanup_begin_failed:${receiptTicketId}`); const receiptRemoved = await remove(receiptTicketId); journal.append({ event: 'ticket_retired', ticketId: sourceTicketId, receiptTicketId, receiptDeleted: receiptRemoved.deleted === true || receiptRemoved.missing === true }); return { sourceDeleted: sourceRemoved.deleted === true || sourceRemoved.missing === true, receiptDeleted: receiptRemoved.deleted === true || receiptRemoved.missing === true };
  }
  return { cleanupPair };
}
