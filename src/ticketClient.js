export function createTicketClient({ baseUrl = process.env.TICKETS_BASE_URL, fetchFn = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!baseUrl || typeof fetchFn !== 'function') throw new Error('ticket_client_config_invalid');
  const root = String(baseUrl).replace(/\/+$/, '');
  async function request(method, route, payload, signal) {
    for (let attempt = 0; ; attempt += 1) {
      const result = await fetchFn(`${root}/_functions/tickets${route || ''}`, { method, headers: { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), ...(signal ? { signal } : {}) });
      const body = await result.json().catch(() => ({}));
      if (!result.ok) { if ([429, 502, 503, 504].includes(result.status) && attempt < 4) { await sleep([1000, 5000, 30000, 120000][attempt]); continue; } const error = new Error(body.code || `ticket_http_${result.status}`); error.status = result.status; error.body = body; throw error; }
      return body;
    }
  }
  return { create: (ticket, options) => request('POST', '', ticket, options?.signal), get: (ticketId, options) => request('GET', `/${encodeURIComponent(ticketId)}`, undefined, options?.signal), mutate: (ticketId, patch, options) => request('PUT', `/${encodeURIComponent(ticketId)}`, patch, options?.signal), list: (query, options) => request('GET', `?${new URLSearchParams(query)}`, undefined, options?.signal), remove: (ticketId, options) => request('DELETE', `/${encodeURIComponent(ticketId)}`, undefined, options?.signal) };
}
