export function createTicketReconciler({ client, identity, log, onTicket = async () => {}, onReceipt = async () => {}, onMaintenance = async () => {} } = {}) {
  if (!client || !identity || !log) throw new Error('ticket_reconciler_config_invalid');
  async function once() {
    let cursor; let scannedCount = 0; let handled = 0; let hasMore = false; let pages = 0; await onMaintenance();
    do { const page = await client.list({ targetMachineKey: identity.machineKey, targetProjectKey: identity.projectKey, limit: '100', ...(cursor ? { cursor } : {}) }); scannedCount += page.scannedCount || 0; hasMore = Boolean(page.hasMore); cursor = page.nextCursor; pages += 1; for (const ticket of page.items || []) { if (ticket.status === 'pending') { await onTicket(ticket); handled += 1; } else if (ticket.kind === 'receipt' && ticket.status === 'awaiting_ack') { await onReceipt(ticket); handled += 1; } } } while (hasMore && cursor && pages < 10);
    return { scannedCount, handled, hasMore };
  }
  return { once, start(intervalMs = 30000) { const timer = setInterval(() => void once().catch((error) => log({ event: 'reconcile_failed', error: error.message })), intervalMs); return () => clearInterval(timer); } };
}
