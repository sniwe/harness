export function createTicketReconciler({ client, identity, log, onTicket = async () => {}, onReceipt = async () => {} } = {}) {
  if (!client || !identity || !log) throw new Error('ticket_reconciler_config_invalid');
  async function once() {
    const page = await client.list({ targetMachineKey: identity.machineKey, targetProjectKey: identity.projectKey, limit: '100' }); let handled = 0;
    for (const ticket of page.items || []) { if (ticket.status === 'pending') { await onTicket(ticket); handled += 1; } else if (ticket.kind === 'receipt' && ticket.status === 'awaiting_ack') { await onReceipt(ticket); handled += 1; } }
    return { scannedCount: page.scannedCount || 0, handled, hasMore: Boolean(page.hasMore) };
  }
  return { once, start(intervalMs = 30000) { const timer = setInterval(() => void once().catch((error) => log({ event: 'reconcile_failed', error: error.message })), intervalMs); return () => clearInterval(timer); } };
}
