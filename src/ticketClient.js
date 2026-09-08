export function createTicketClient({ baseUrl = process.env.TICKETS_BASE_URL, fetchFn = globalThis.fetch, timeoutMs = 30000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!baseUrl || typeof fetchFn !== 'function') throw new Error('ticket_client_config_invalid');
  const root = String(baseUrl).replace(/\/+$/, '');
  async function request(method, route, payload) {
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await fetchFn(`${root}/_functions/tickets${route || ''}`, { method, headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal: controller.signal });
        const body = await result.json().catch(() => ({}));
        if (!result.ok) { if ([429, 502, 503, 504].includes(result.status) && attempt < 4) { await sleep([1000, 5000, 30000, 120000][attempt]); continue; } const error = new Error(body.code || `ticket_http_${result.status}`); error.status = result.status; error.body = body; throw error; }
        return body;
      } finally { clearTimeout(timer); }
    }
  }
  return { create: (ticket) => request('POST', '', ticket), get: (ticketId) => request('GET', `/${encodeURIComponent(ticketId)}`), mutate: (ticketId, patch) => request('PUT', `/${encodeURIComponent(ticketId)}`, patch), list: (query) => request('GET', `?${new URLSearchParams(query)}`), remove: (ticketId) => request('DELETE', `/${encodeURIComponent(ticketId)}`) };
}
