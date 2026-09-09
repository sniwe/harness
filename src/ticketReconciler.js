import fs from 'node:fs';
import path from 'node:path';

export function createTicketReconciler({ client, identity, log, onTicket = async () => {}, onReceipt = async () => {}, onMaintenance = async () => {}, cursorFile } = {}) {
  if (!client || !identity || !log) throw new Error('ticket_reconciler_config_invalid');
  const readCursor = () => cursorFile && fs.existsSync(cursorFile) ? JSON.parse(fs.readFileSync(cursorFile, 'utf8')).cursor : undefined;
  const saveCursor = (cursor) => { if (!cursorFile) return; fs.mkdirSync(path.dirname(cursorFile), { recursive: true }); const temporary = `${cursorFile}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify({ cursor }) + '\n', 'utf8'); fs.renameSync(temporary, cursorFile); };
  const clearCursor = () => { if (cursorFile) try { fs.unlinkSync(cursorFile); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
  let scanning = false;
  async function once() {
    if (scanning) return { skipped: true, reason: 'scan_in_progress' };
    scanning = true;
    try { let cursor = readCursor(); let scannedCount = 0; let handled = 0; let hasMore = false; let pages = 0;
      try { await onMaintenance(); } catch (error) { log({ event: 'reconcile_maintenance_failed', error: error.message }); }
      do { const page = await client.list({ targetMachineKey: identity.machineKey, targetProjectKey: identity.projectKey, limit: '100', ...(cursor ? { cursor } : {}) }); scannedCount += page.scannedCount || 0; hasMore = Boolean(page.hasMore); cursor = page.nextCursor; if (hasMore && cursor) saveCursor(cursor); else clearCursor(); pages += 1; for (const ticket of page.items || []) { const action = ticket.status === 'pending' ? onTicket : ticket.kind === 'receipt' && ticket.status === 'awaiting_ack' ? onReceipt : null; if (!action) continue; handled += 1; Promise.resolve().then(() => action(ticket)).catch((error) => log({ event: 'reconcile_item_failed', ticketId: ticket.ticketId, error: error.message })); } } while (hasMore && cursor && pages < 10);
      return { scannedCount, handled, hasMore };
    } finally { scanning = false; }
  }
  return { once, start(intervalMs = 30000) { const timer = setInterval(() => void once().catch((error) => log({ event: 'reconcile_failed', error: error.message })), intervalMs); return () => clearInterval(timer); } };
}
