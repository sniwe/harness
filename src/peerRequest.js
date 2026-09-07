import crypto from "node:crypto";
import { createPeerPing } from "./peerPing.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 600000;
const MAX_TIMEOUT_MS = 1800000;
const MAX_PROMPT_CHARS = 32768;
const MAX_RESULT_BYTES = 256 * 1024;
const MAX_BODY_BYTES = 64 * 1024;

export function validateRemotePromptEnvelope(payload, { targetKey, maxPromptChars = MAX_PROMPT_CHARS } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw peerRequestError(400, "request_schema_invalid");
  if (typeof payload.requestId !== "string" || !UUID.test(payload.requestId)) throw peerRequestError(400, "request_id_invalid");
  if (typeof payload.targetTunnelKey !== "string" || payload.targetTunnelKey !== targetKey) throw peerRequestError(400, "target_key_invalid");
  if (typeof payload.prompt !== "string" || payload.prompt.trim() === "" || payload.prompt.length > maxPromptChars) throw peerRequestError(400, "prompt_invalid");
  if (payload.timeoutMs !== undefined && (!Number.isInteger(payload.timeoutMs) || payload.timeoutMs < 1)) throw peerRequestError(400, "timeout_invalid");
  const allowed = new Set(["requestId", "targetTunnelKey", "prompt", "timeoutMs"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw peerRequestError(400, "request_fields_invalid");
  return { ...payload, timeoutMs: clampTimeout(payload.timeoutMs) };
}

export function createPeerRequestClient({ registryUrl, localKey, callerKey = localKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = 2000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), requestId = () => crypto.randomUUID() } = {}) {
  const peerPing = createPeerPing({ registryUrl, localKey, fetchImpl, timeoutMs: Math.min(timeoutMs, 30000) });
  return { send: (peerKey, prompt, requestedTimeoutMs) => sendPeerRequest({ peerPing, peerKey, prompt, callerKey, fetchImpl, timeoutMs: clampTimeout(requestedTimeoutMs || timeoutMs), pollMs, sleep, requestId }) };
}

async function sendPeerRequest({ peerPing, peerKey, prompt, callerKey, fetchImpl, timeoutMs, pollMs, sleep, requestId }) {
  if (typeof prompt !== "string" || prompt.trim() === "" || prompt.length > MAX_PROMPT_CHARS) throw peerRequestError(400, "prompt_invalid");
  const peer = await peerPing.lookup(peerKey);
  const id = requestId();
  const payload = validateRemotePromptEnvelope({ requestId: id, targetTunnelKey: peer.tunnelKey, prompt, timeoutMs }, { targetKey: peer.tunnelKey });
  const accepted = await fetchPeer(fetchImpl, `${peer.tunnelUrl}/api/machine-base/peer-request`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Machine-Base-Caller-Key": callerKey }, body: JSON.stringify(payload), redirect: "error" }, Math.min(30000, timeoutMs));
  if (!accepted.response.ok) throw peerRequestError(accepted.response.status >= 500 ? 502 : accepted.response.status, accepted.body?.error || `peer_http_${accepted.response.status}`, { requestId: id, state: accepted.body?.state || "not_started" });
  if (!accepted.body || accepted.body.requestId !== id || accepted.body.targetKey !== peer.tunnelKey || accepted.body.callerKey !== callerKey) throw peerRequestError(502, "peer_accept_invalid", { requestId: id, state: "unknown_execution_state" });
  if (accepted.body.state === "completed") return { ...accepted.body, peer };
  if (!["accepted", "in_progress"].includes(accepted.body.state)) throw peerRequestError(502, "peer_accept_state_invalid", { requestId: id, state: "unknown_execution_state" });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    let currentPeer;
    try { currentPeer = await peerPing.lookup(peerKey); }
    catch { if (Date.now() < deadline) continue; throw peerRequestError(504, "peer_status_timeout", { requestId: id, state: "unknown_execution_state" }); }
    try {
      const statusUrl = `${currentPeer.tunnelUrl}/api/machine-base/peer-request-status?requestId=${encodeURIComponent(id)}&targetTunnelKey=${encodeURIComponent(currentPeer.tunnelKey)}`;
      const observed = await fetchPeer(fetchImpl, statusUrl, { method: "GET", headers: { Accept: "application/json", "X-Machine-Base-Caller-Key": callerKey }, redirect: "error" }, Math.min(30000, Math.max(1000, deadline - Date.now())));
      if (observed.response.status === 404) continue;
      if (!observed.response.ok) throw peerRequestError(observed.response.status >= 500 ? 502 : observed.response.status, observed.body?.error || `peer_status_http_${observed.response.status}`, { requestId: id, state: observed.body?.state || "unknown_execution_state" });
      const body = observed.body;
      if (!body || body.requestId !== id || body.targetKey !== currentPeer.tunnelKey || body.callerKey !== callerKey) throw peerRequestError(502, "peer_status_invalid", { requestId: id, state: "unknown_execution_state" });
      if (body.state === "completed") return { ...body, peer: currentPeer };
      if (body.state === "timed_out" || body.state === "worker_failed") throw peerRequestError(body.state === "timed_out" ? 504 : 502, body.error || body.state, { requestId: id, state: body.state });
    } catch (error) {
      if (error.status === 400 || error.message === "worker_timeout" || error.message === "worker_failed") throw error;
      if (Date.now() >= deadline) throw peerRequestError(504, "peer_status_timeout", { requestId: id, state: "unknown_execution_state" });
    }
  }
  throw peerRequestError(504, "peer_request_timeout", { requestId: id, state: "unknown_execution_state" });
}

async function fetchPeer(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    let body;
    try { body = await readBoundedJson(response); } catch (error) { throw peerRequestError(502, error.message === "peer_response_too_large" ? error.message : "peer_invalid_json"); }
    return { response, body };
  } catch (error) {
    if (error.name === "AbortError") throw peerRequestError(504, "peer_request_timeout", { state: "unknown_execution_state" });
    throw error;
  } finally { clearTimeout(timer); }
}

export function createPeerRequestHandler({ pool, targetKey, enabled = true, maxInFlight = 1, timeoutMs = MAX_TIMEOUT_MS, maxPromptChars = MAX_PROMPT_CHARS, now = () => new Date().toISOString() } = {}) {
  const jobs = new Map();
  const activeCount = () => [...jobs.values()].filter((job) => ["accepted", "in_progress"].includes(job.body.state)).length;
  const prune = () => { while (jobs.size > 256) { const first = jobs.entries().next().value; if (!first || ["accepted", "in_progress"].includes(first[1].body.state)) break; jobs.delete(first[0]); } };
  async function execute(job, request) {
    job.body.state = "in_progress";
    job.body.startedAt = now();
    try {
      const result = await pool.request({ task: "remote-prompt", requestId: request.requestId, prompt: request.prompt }, Math.min(request.timeoutMs, timeoutMs));
      const output = result?.result ?? result?.output ?? result;
      if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_RESULT_BYTES) throw new Error("worker_result_too_large");
      job.body = { ...job.body, ok: true, state: "completed", workerSlot: result?.workerSlot || "unknown", completedAt: now(), result: output };
    } catch (error) {
      const timedOut = /timeout/i.test(error.message || "");
      job.body = { ...job.body, ok: false, state: timedOut ? "timed_out" : "worker_failed", completedAt: now(), error: timedOut ? "worker_timeout" : error.message || "worker_failed" };
    } finally { prune(); }
  }
  return {
    get state() { return { enabled, inFlight: activeCount(), maxInFlight }; },
    async handle({ headers = {}, payload } = {}) {
      const requestId = payload?.requestId || "";
      if (!enabled) return failure(403, "peer_route_disabled", requestId, targetKey, "not_started");
      const callerKey = String(headers["x-machine-base-caller-key"] || "unknown");
      let request;
      try { request = validateRemotePromptEnvelope(payload, { targetKey, maxPromptChars }); }
      catch (error) { return failure(error.status || 400, error.message, requestId, targetKey, "not_started", callerKey); }
      const existing = jobs.get(request.requestId);
      if (existing) return failure(409, existing.body.state === "completed" ? "request_already_completed" : "request_in_progress_or_duplicate", request.requestId, targetKey, existing.body.state, callerKey);
      if (activeCount() >= maxInFlight) return failure(429, "peer_worker_capacity_exhausted", request.requestId, targetKey, "not_started", callerKey);
      const job = { body: { ok: true, requestId: request.requestId, callerKey, targetKey, state: "accepted" } };
      jobs.set(request.requestId, job);
      void execute(job, request);
      return { status: 202, body: job.body };
    },
    status({ requestId, targetKey: requestedTargetKey } = {}) {
      if (!enabled) return failure(403, "peer_route_disabled", requestId || "", targetKey, "not_started");
      if (typeof requestId !== "string" || !UUID.test(requestId)) return failure(400, "request_id_invalid", requestId || "", targetKey, "not_started");
      if (requestedTargetKey !== targetKey) return failure(400, "target_key_invalid", requestId, targetKey, "not_started");
      const job = jobs.get(requestId);
      if (!job) return failure(404, "request_not_found", requestId, targetKey, "not_started");
      return { status: 200, body: job.body };
    },
  };
}

function clampTimeout(value) { return Math.min(MAX_TIMEOUT_MS, Math.max(1000, Number.isInteger(value) ? value : DEFAULT_TIMEOUT_MS)); }
async function readBoundedJson(response) {
  if (typeof response.text !== "function") return response.json();
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > Math.max(MAX_RESULT_BYTES, MAX_BODY_BYTES)) throw new Error("peer_response_too_large");
  return JSON.parse(text);
}
function failure(status, error, requestId, targetKey, state, callerKey = "", startedAt = undefined) { return { status, body: { ok: false, requestId, callerKey, targetKey, state, ...(startedAt ? { startedAt } : {}), error } }; }
function peerRequestError(status, message, extra = {}) { return Object.assign(new Error(message), { status, ...extra }); }

export const peerRequestLimits = { MAX_PROMPT_CHARS, MAX_RESULT_BYTES, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MAX_BODY_BYTES };
