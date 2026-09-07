const DEFAULT_TIMEOUT_MS = 10000;

export function createCommitSyncClient({ registryUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!registryUrl) throw new Error("peer_registry_url_required");
  const request = async (url, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) }, redirect: "error", signal: controller.signal });
    } catch (error) { throw Object.assign(new Error(error.name === "AbortError" ? "peer_request_timeout" : "peer_request_failed"), { status: 502 }); }
    finally { clearTimeout(timer); }
  };
  async function lookup(peerKey) {
    const url = new URL(registryUrl);
    url.searchParams.set("tunnelKey", String(peerKey || "").trim());
    const response = await request(url);
    if (!response.ok) throw Object.assign(new Error(`peer_registry_http_${response.status}`), { status: 502 });
    const body = await response.json();
    const items = Array.isArray(body?.items) ? body.items.filter((item) => item?.tunnelKey === String(peerKey).trim()) : [];
    if (items.length === 0) throw Object.assign(new Error("peer_not_found"), { status: 404 });
    if (items.length !== 1) throw Object.assign(new Error("peer_registry_duplicate_key"), { status: 502 });
    const peerUrl = new URL(items[0].title);
    if (peerUrl.protocol !== "https:" || !peerUrl.hostname.toLowerCase().endsWith(".trycloudflare.com") || peerUrl.username || peerUrl.password || peerUrl.search || peerUrl.hash) throw Object.assign(new Error("peer_url_invalid"), { status: 502 });
    return { tunnelKey: String(peerKey).trim(), tunnelUrl: peerUrl.toString().replace(/\/$/, "") };
  }
  async function post(peerKey, route, body = {}) {
    const peer = await lookup(peerKey);
    const response = await request(`${peer.tunnelUrl}${route}`, { method: "POST", body: JSON.stringify(body) });
    let result = null;
    try { result = await response.json(); } catch { throw Object.assign(new Error("peer_invalid_json"), { status: 502 }); }
    if (!response.ok) throw Object.assign(new Error(result?.error || `peer_http_${response.status}`), { status: response.status });
    return { peer, result, status: response.status };
  }
  return { lookup, status: (peerKey) => post(peerKey, "/api/machine-base/commit-status"), sync: (peerKey, body) => post(peerKey, "/api/machine-base/commit-sync", body) };
}

export async function coordinatePeers({ client, peerKeys, localKey, target, waitMs = 60000, pollMs = 2000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const results = [];
  for (const peerKey of peerKeys) {
    if (!peerKey || peerKey === localKey) continue;
    try {
      let status = await client.status(peerKey);
      if (isMatch(status.result, target)) { results.push({ peerKey, state: "match", status: status.result }); continue; }
      await client.sync(peerKey, { runId: target.runId, expectedCommit: target.commit, branch: target.branch });
      const deadline = Date.now() + waitMs;
      do {
        await sleep(pollMs);
        status = await client.status(peerKey);
        if (isMatch(status.result, target)) { results.push({ peerKey, state: "converged", status: status.result }); break; }
      } while (Date.now() < deadline);
      if (results.at(-1)?.peerKey !== peerKey) results.push({ peerKey, state: "timeout", status: status.result });
    } catch (error) { results.push({ peerKey, state: "error", error: error.message, status: error.status || 502 }); }
  }
  return { ok: results.every((item) => item.state === "match" || item.state === "converged"), target, peers: results };
}

function isMatch(status, target) { return status?.commit?.commit === target.commit && status?.commit?.branch === target.branch && status?.commit?.confirmed === true && status?.tunnel?.running === true && Boolean(status?.tunnel?.publishedUrl); }
