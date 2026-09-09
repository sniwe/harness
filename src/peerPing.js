export function createPeerPing({ registryUrl, localKey, fetchImpl = fetch } = {}) {
  if (!registryUrl) throw new Error("peer_registry_url_required");
  return { lookup: (peerKey, options) => lookupPeer({ registryUrl, localKey, peerKey, fetchImpl, signal: options?.signal }), ping: (peerKey, options) => pingPeer({ registryUrl, localKey, peerKey, fetchImpl, signal: options?.signal }) };
}

async function lookupPeer({ registryUrl, localKey, peerKey, fetchImpl, signal }) {
  if (typeof peerKey !== "string" || !peerKey.trim()) throw peerError(400, "peer_key_required");
  peerKey = peerKey.trim();
  if (peerKey === localKey) throw peerError(400, "cannot_ping_local_peer");
  const url = new URL(registryUrl);
  url.searchParams.set("tunnelKey", peerKey);
  const response = await fetchWithSignal(fetchImpl, url, signal);
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

async function pingPeer({ registryUrl, localKey, peerKey, fetchImpl, signal }) {
  const peer = await lookupPeer({ registryUrl, localKey, peerKey, fetchImpl, signal });
  const started = Date.now();
  const response = await fetchWithSignal(fetchImpl, `${peer.tunnelUrl}/api/machine-base/ping`, signal);
  if (!response.ok) throw peerError(502, `peer_ping_http_${response.status}`);
  let body;
  try { body = await response.json(); } catch { throw peerError(502, "peer_ping_invalid_json"); }
  if (body?.ok !== true || body.tunnelKey !== peer.tunnelKey || body.serverRole !== "machine-base") throw peerError(502, "peer_ping_identity_mismatch");
  return { ok: true, peer, status: response.status, elapsedMs: Date.now() - started, pong: body };
}

async function fetchWithSignal(fetchImpl, input, signal) {
  try { return await fetchImpl(input, { method: "GET", headers: { Accept: "application/json" }, redirect: "error", ...(signal ? { signal } : {}) }); }
  catch (error) { throw peerError(502, error.name === "AbortError" ? "peer_request_cancelled" : "peer_request_failed"); }
}

function peerError(status, message) { return Object.assign(new Error(message), { status }); }
