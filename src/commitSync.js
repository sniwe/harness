export function createCommitSyncClient({ registryUrl, fetchImpl = fetch } = {}) {
  if (!registryUrl) throw new Error("peer_registry_url_required");
  const request = async (url, init = {}, signal) => {
    try {
      return await fetchImpl(url, { ...init, headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) }, redirect: "error", ...(signal ? { signal } : {}) });
    } catch (error) { throw Object.assign(new Error(error.name === "AbortError" ? "peer_request_cancelled" : "peer_request_failed"), { status: 502 }); }
  };
  async function list({ signal } = {}) {
    const response = await request(registryUrl, {}, signal);
    if (!response.ok) throw Object.assign(new Error(`peer_registry_http_${response.status}`), { status: 502 });
    const body = await response.json();
    if (!Array.isArray(body?.items)) throw Object.assign(new Error("peer_registry_invalid_items"), { status: 502 });
    return body.items;
  }
  async function lookup(peerKey, { signal } = {}) {
    const url = new URL(registryUrl);
    url.searchParams.set("tunnelKey", String(peerKey || "").trim());
    const response = await request(url, {}, signal);
    if (!response.ok) throw Object.assign(new Error(`peer_registry_http_${response.status}`), { status: 502 });
    const body = await response.json();
    const items = Array.isArray(body?.items) ? body.items.filter((item) => item?.tunnelKey === String(peerKey).trim()) : [];
    if (items.length === 0) throw Object.assign(new Error("peer_not_found"), { status: 404 });
    if (items.length !== 1) throw Object.assign(new Error("peer_registry_duplicate_key"), { status: 502 });
    const peerUrl = new URL(items[0].title);
    if (peerUrl.protocol !== "https:" || !peerUrl.hostname.toLowerCase().endsWith(".trycloudflare.com") || peerUrl.username || peerUrl.password || peerUrl.search || peerUrl.hash) throw Object.assign(new Error("peer_url_invalid"), { status: 502 });
    return { tunnelKey: String(peerKey).trim(), tunnelUrl: peerUrl.toString().replace(/\/$/, "") };
  }
  async function post(peerKey, route, body = {}, { signal } = {}) {
    const peer = await lookup(peerKey, { signal });
    const response = await request(`${peer.tunnelUrl}${route}`, { method: "POST", body: JSON.stringify(body) }, signal);
    let result = null;
    try { result = await response.json(); } catch { throw Object.assign(new Error("peer_invalid_json"), { status: 502 }); }
    if (!response.ok) throw Object.assign(new Error(result?.error || `peer_http_${response.status}`), { status: response.status });
    return { peer, result, status: response.status };
  }
  return { list, lookup, status: (peerKey, options) => post(peerKey, "/api/machine-base/commit-status", {}, options), sync: (peerKey, body, options) => post(peerKey, "/api/machine-base/commit-sync", body, options) };
}

export async function coordinatePeers({ client, peerKeys, localKey, target, pollMs = 2000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), signal } = {}) {
  const results = [];
  for (const peerKey of peerKeys) {
    throwIfCancelled(signal);
    if (!peerKey || peerKey === localKey) continue;
    try {
      let status = await client.status(peerKey, { signal });
      if (isMatch(status.result, target)) { results.push({ peerKey, state: "match", status: status.result }); continue; }
      await client.sync(peerKey, { runId: target.runId, expectedCommit: target.commit, branch: target.branch }, { signal });
      let lastError = null;
      while (true) {
        throwIfCancelled(signal);
        await sleep(pollMs);
        throwIfCancelled(signal);
        try {
          status = await client.status(peerKey, { signal });
          lastError = null;
          if (isMatch(status.result, target)) { results.push({ peerKey, state: "converged", status: status.result }); break; }
        } catch (error) { lastError = { error: error.message, status: error.status || 502 }; }
      }
    } catch (error) { if (signal?.aborted) throw new Error("commit_coordination_cancelled"); results.push({ peerKey, state: "error", error: error.message, status: error.status || 502 }); }
  }
  return { ok: results.every((item) => item.state === "match" || item.state === "converged"), target, peers: results };
}

function isMatch(status, target) { return status?.commit?.commit === target.commit && status?.commit?.branch === target.branch && status?.commit?.confirmed === true && status?.tunnel?.running === true && Boolean(status?.tunnel?.publishedUrl); }
function throwIfCancelled(signal) { if (signal?.aborted) throw new Error("commit_coordination_cancelled"); }
