import crypto from "node:crypto";
import { createPeerPing } from "./peerPing.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 120000;
const MAX_PROMPT_CHARS = 32768;
const MAX_RESULT_BYTES = 256 * 1024;

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

export function createPeerRequestClient({ registryUrl, localKey, callerKey = localKey, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, requestId = () => crypto.randomUUID() } = {}) {
  const peerPing = createPeerPing({ registryUrl, localKey, fetchImpl, timeoutMs });
  return { send: (peerKey, prompt, requestedTimeoutMs) => sendPeerRequest({ peerPing, peerKey, prompt, callerKey, fetchImpl, timeoutMs: clampTimeout(requestedTimeoutMs || timeoutMs), requestId }) };
}

async function sendPeerRequest({ peerPing, peerKey, prompt, callerKey, fetchImpl, timeoutMs, requestId }) {
  if (typeof prompt !== "string" || prompt.trim() === "" || prompt.length > MAX_PROMPT_CHARS) throw peerRequestError(400, "prompt_invalid");
  const peer = await peerPing.lookup(peerKey);
  const id = requestId();
  const payload = validateRemotePromptEnvelope({ requestId: id, targetTunnelKey: peer.tunnelKey, prompt, timeoutMs }, { targetKey: peer.tunnelKey });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${peer.tunnelUrl}/api/machine-base/peer-request`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", "X-Machine-Base-Caller-Key": callerKey }, body: JSON.stringify(payload), redirect: "error", signal: controller.signal });
    let body;
    try { body = await readBoundedJson(response); } catch (error) { throw peerRequestError(502, error.message === "peer_response_too_large" ? error.message : "peer_invalid_json"); }
    if (!response.ok) throw peerRequestError(response.status >= 500 ? 502 : response.status, body?.error || `peer_http_${response.status}`, { requestId: id, state: body?.state || "not_started" });
    if (!body || body.requestId !== id || body.targetKey !== peer.tunnelKey || body.callerKey !== callerKey || typeof body.state !== "string") throw peerRequestError(502, "peer_response_invalid", { requestId: id, state: "unknown_execution_state" });
    if (body.state !== "completed" || body.ok !== true) throw peerRequestError(502, "peer_request_not_completed", { requestId: id, state: body.state });
    return { ...body, peer };
  } catch (error) {
    if (error.name === "AbortError") throw peerRequestError(504, "peer_request_timeout", { requestId: id, state: "unknown_execution_state" });
    throw error;
  } finally { clearTimeout(timer); }
}

export function createPeerRequestHandler({ pool, targetKey, enabled = true, maxInFlight = 1, timeoutMs = DEFAULT_TIMEOUT_MS, maxPromptChars = MAX_PROMPT_CHARS, now = () => new Date().toISOString() } = {}) {
  const inFlight = new Set();
  const completed = new Set();
  return {
    get state() { return { enabled, inFlight: inFlight.size, maxInFlight }; },
    async handle({ headers = {}, payload } = {}) {
      const requestId = payload?.requestId || "";
      if (!enabled) return failure(403, "peer_route_disabled", requestId, targetKey, "not_started");
      const callerKey = String(headers["x-machine-base-caller-key"] || "unknown");
      let request;
      try { request = validateRemotePromptEnvelope(payload, { targetKey, maxPromptChars }); }
      catch (error) { return failure(error.status || 400, error.message, requestId, targetKey, "not_started", callerKey); }
      if (completed.has(request.requestId)) return failure(409, "request_already_completed", request.requestId, targetKey, "duplicate", callerKey);
      if (inFlight.has(request.requestId)) return failure(409, "request_in_progress_or_duplicate", request.requestId, targetKey, "in_progress", callerKey);
      if (inFlight.size >= maxInFlight) return failure(429, "peer_worker_capacity_exhausted", request.requestId, targetKey, "not_started", callerKey);
      inFlight.add(request.requestId);
      const startedAt = now();
      try {
        const result = await pool.request({ task: "remote-prompt", requestId: request.requestId, prompt: request.prompt }, Math.min(request.timeoutMs, timeoutMs));
        const output = result?.result ?? result?.output ?? result;
        const serialized = JSON.stringify(output);
        if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) return failure(502, "worker_result_too_large", request.requestId, targetKey, "worker_failed", callerKey, startedAt);
        completed.add(request.requestId);
        if (completed.size > 256) completed.delete(completed.values().next().value);
        return { status: 200, body: { ok: true, requestId: request.requestId, callerKey, targetKey, state: "completed", workerSlot: result?.workerSlot || "unknown", startedAt, completedAt: now(), result: output } };
      } catch (error) {
        const timeout = /timeout/i.test(error.message || "");
        completed.add(request.requestId);
        if (completed.size > 256) completed.delete(completed.values().next().value);
        return failure(timeout ? 504 : 502, timeout ? "worker_timeout" : "worker_failed", request.requestId, targetKey, timeout ? "timed_out" : "worker_failed", callerKey, startedAt);
      } finally { inFlight.delete(request.requestId); }
    },
  };
}

function clampTimeout(value) { return Math.min(MAX_TIMEOUT_MS, Math.max(1000, Number.isInteger(value) ? value : DEFAULT_TIMEOUT_MS)); }
function safeTokenEqual(actual, expected) { const left = Buffer.from(String(actual || "")); const right = Buffer.from(String(expected || "")); return left.length === right.length && crypto.timingSafeEqual(left, right); }
async function readBoundedJson(response) {
  if (typeof response.text !== "function") return response.json();
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESULT_BYTES) throw new Error("peer_response_too_large");
  return JSON.parse(text);
}
function failure(status, error, requestId, targetKey, state, callerKey = "", startedAt = undefined) { return { status, body: { ok: false, requestId, callerKey, targetKey, state, ...(startedAt ? { startedAt } : {}), error } }; }
function peerRequestError(status, message, extra = {}) { return Object.assign(new Error(message), { status, ...extra }); }

export const peerRequestLimits = { MAX_PROMPT_CHARS, MAX_RESULT_BYTES, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS };
