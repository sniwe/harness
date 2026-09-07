const DEFAULT_TIMEOUT_MS = 5000;

export function createPeerPing({ registryUrl, localKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!registryUrl) throw new Error("peer_registry_url_required");
  return { lookup: (peerKey) => lookupPeer({ registryUrl, localKey, peerKey, fetchImpl, timeoutMs }), ping: (peerKey) => pingPeer({ registryUrl, localKey, peerKey, fetchImpl, timeoutMs }) };
}

async function lookupPeer({ registryUrl, localKey, peerKey, fetchImpl, timeoutMs }) {
  if (typeof peerKey !== "string" || !peerKey.trim()) throw peerError(400, "peer_key_required");
  peerKey = peerKey.trim();
  if (peerKey === localKey) throw peerError(400, "cannot_ping_local_peer");
  const url = new URL(registryUrl);
  url.searchParams.set("tunnelKey", peerKey);
  const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
  if (!response.ok) throw peerError(502, `peer_registry_http_${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw peerError(502, "peer_registry_invalid_json"); }
  const items = Array.isArray(body?.items) ? body.items.filter((item) => item?.tunnelKey === peerKey) : [];
  if (items.length === 0) throw peerError(404, "peer_not_found");
  if (items.length !== 1) throw peerError(502, "peer_registry_duplicate_key");
  const title = items[0].title;
  let peerUrl;
  try { peerUrl = new URL(title); } catch { throw peerError(502, "peer_url_invalid"); }
  if (peerUrl.protocol !== "https:" || !peerUrl.hostname.toLowerCase().endsWith(".trycloudflare.com") || peerUrl.username || peerUrl.password || peerUrl.search || peerUrl.hash) throw peerError(502, "peer_url_invalid");
  return { tunnelKey: peerKey, tunnelUrl: peerUrl.toString().replace(/\/$/, "") };
}

async function pingPeer({ registryUrl, localKey, peerKey, fetchImpl, timeoutMs }) {
  const peer = await lookupPeer({ registryUrl, localKey, peerKey, fetchImpl, timeoutMs });
  const started = Date.now();
  const response = await fetchWithTimeout(fetchImpl, `${peer.tunnelUrl}/api/machine-base/ping`, timeoutMs);
  if (!response.ok) throw peerError(502, `peer_ping_http_${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw peerError(502, "peer_ping_invalid_json"); }
  if (body?.ok !== true || body.tunnelKey !== peer.tunnelKey || body.serverRole !== "machine-base") throw peerError(502, "peer_ping_identity_mismatch");
  return { ok: true, peer, status: response.status, elapsedMs: Date.now() - started, pong: body };
}

async function fetchWithTimeout(fetchImpl, input, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(input, { method: "GET", headers: { Accept: "application/json" }, redirect: "error", signal: controller.signal }); }
  catch (error) { throw peerError(502, error.name === "AbortError" ? "peer_request_timeout" : "peer_request_failed"); }
  finally { clearTimeout(timer); }
}

function peerError(status, message) { return Object.assign(new Error(message), { status }); }
