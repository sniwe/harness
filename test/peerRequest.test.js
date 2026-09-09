import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createPeerRequestClient, createPeerRequestHandler, validateRemotePromptEnvelope } from "../src/peerRequest.js";

const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

test("remote prompt envelope is strict and bounded", () => {
  assert.deepEqual(validateRemotePromptEnvelope({ requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY" }, { targetKey: "machine-base-peer" }), { requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY" });
  assert.throws(() => validateRemotePromptEnvelope({ requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY", timeoutMs: 999999 }, { targetKey: "machine-base-peer" }), /request_fields_invalid/);
  assert.throws(() => validateRemotePromptEnvelope({ requestId: id, targetTunnelKey: "machine-base-other", prompt: "READY" }, { targetKey: "machine-base-peer" }), /target_key_invalid/);
  assert.throws(() => validateRemotePromptEnvelope({ requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY", cwd: "C:\\" }, { targetKey: "machine-base-peer" }), /request_fields_invalid/);
});

test("peer sender accepts then persistently polls the fixed status route", async () => {
  const calls = [];
  const client = createPeerRequestClient({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "machine-base-local", callerKey: "machine-base-local", pollMs: 1, sleep: async () => {}, requestId: () => id, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://registry.test/")) return response({ items: [{ tunnelKey: "machine-base-peer", title: "https://peer.trycloudflare.com" }] });
    if (String(url).endsWith("/api/machine-base/peer-request")) return response({ ok: true, requestId: id, callerKey: "machine-base-local", targetKey: "machine-base-peer", state: "accepted" }, 202);
    return response({ ok: true, requestId: id, callerKey: "machine-base-local", targetKey: "machine-base-peer", state: "completed", result: "READY" });
  } });
  const result = await client.send("machine-base-peer", "Return exactly READY.");
  assert.equal(result.result, "READY");
  assert.equal(calls[1].url, "https://peer.trycloudflare.com/api/machine-base/peer-request");
  assert.equal(calls[1].init.headers["X-Machine-Base-Caller-Key"], "machine-base-local");
  assert.equal(calls[3].url, `https://peer.trycloudflare.com/api/machine-base/peer-request-status?requestId=${id}&targetTunnelKey=machine-base-peer`);
});

test("peer sender survives transient lookup and status failures after acceptance", async () => {
  let registryCalls = 0;
  let statusCalls = 0;
  const client = createPeerRequestClient({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "machine-base-local", pollMs: 1, sleep: async () => {}, requestId: () => id, fetchImpl: async (url) => {
    const value = String(url);
    if (value.startsWith("https://registry.test/")) {
      registryCalls += 1;
      if (registryCalls === 2) throw new Error("temporary_registry_failure");
      return response({ items: [{ tunnelKey: "machine-base-peer", title: "https://peer.trycloudflare.com" }] });
    }
    if (value.endsWith("/api/machine-base/peer-request")) return response({ ok: true, requestId: id, callerKey: "machine-base-local", targetKey: "machine-base-peer", state: "accepted" }, 202);
    statusCalls += 1;
    if (statusCalls === 1) throw new Error("temporary_status_failure");
    return response({ ok: true, requestId: id, callerKey: "machine-base-local", targetKey: "machine-base-peer", state: "completed", result: "READY" });
  } });
  assert.equal((await client.send("machine-base-peer", "READY")).result, "READY");
  assert.equal(registryCalls >= 3, true);
  assert.equal(statusCalls >= 2, true);
});

test("peer sender can cancel indefinite status polling", async () => {
  const controller = new AbortController(); let sleeps = 0;
  const client = createPeerRequestClient({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "machine-base-local", pollMs: 1, sleep: async () => { sleeps += 1; controller.abort(); }, requestId: () => id, fetchImpl: async (url) => String(url).startsWith("https://registry.test/") ? response({ items: [{ tunnelKey: "machine-base-peer", title: "https://peer.trycloudflare.com" }] }) : response({ ok: true, requestId: id, callerKey: "machine-base-local", targetKey: "machine-base-peer", state: "accepted" }, 202) });
  await assert.rejects(() => client.send("machine-base-peer", "READY", { signal: controller.signal }), /peer_request_cancelled/); assert.equal(sleeps, 1);
});

test("peer handler accepts asynchronously, reports status, and rejects replay", async () => {
  const pool = { request: async ({ task, prompt, requestId }) => ({ ok: true, task, requestId, result: `echo:${prompt}` }) };
  const handler = createPeerRequestHandler({ pool, targetKey: "machine-base-peer", enabled: true });
  const accepted = await handler.handle({ headers: { "x-machine-base-caller-key": "machine-base-local" }, payload: { requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY" } });
  assert.equal(accepted.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(handler.status({ requestId: id, targetKey: "machine-base-peer" }).body.state, "completed");
  assert.equal((await handler.handle({ headers: {}, payload: { requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY" } })).body.error, "request_already_completed");
});

test("peer handler does not publish a failed worker envelope as completed", async () => {
  const handler = createPeerRequestHandler({ pool: { request: async () => ({ ok: false, error: "turn_failed" }) }, targetKey: "peer", enabled: true });
  await handler.handle({ headers: { "x-machine-base-caller-key": "local" }, payload: { requestId: id2, targetTunnelKey: "peer", prompt: "READY" } });
  await new Promise((resolve) => setImmediate(resolve));
  const status = handler.status({ requestId: id2, targetKey: "peer" }).body; assert.equal(status.state, "worker_failed"); assert.equal(status.ok, false); assert.equal(status.error, "turn_failed");
});

test("peer handler enforces in-flight capacity and never exposes prompt in state", async () => {
  let release;
  const pool = { request: () => new Promise((resolve) => { release = resolve; }) };
  const handler = createPeerRequestHandler({ pool, targetKey: "peer", enabled: true, maxInFlight: 1 });
  const first = await handler.handle({ headers: { "x-machine-base-caller-key": "local" }, payload: { requestId: id, targetTunnelKey: "peer", prompt: "PRIVATE" } });
  const second = await handler.handle({ headers: { "x-machine-base-caller-key": "local" }, payload: { requestId: id2, targetTunnelKey: "peer", prompt: "PRIVATE-2" } });
  assert.equal(first.status, 202);
  assert.equal(second.status, 429);
  assert.equal(JSON.stringify(handler.state).includes("PRIVATE"), false);
  release({ ok: true, result: "READY" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(handler.status({ requestId: id, targetKey: "peer" }).body.state, "completed");
});

test("local sender and peer handler complete one HTTP async round trip", async () => {
  const handler = createPeerRequestHandler({ pool: { request: async ({ prompt }) => ({ ok: true, result: `echo:${prompt}` }) }, targetKey: "machine-base-peer", enabled: true });
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://local");
    let result;
    if (request.method === "GET") result = handler.status({ requestId: url.searchParams.get("requestId"), targetKey: url.searchParams.get("targetTunnelKey") });
    else { let body = ""; for await (const chunk of request) body += chunk; result = await handler.handle({ headers: request.headers, payload: JSON.parse(body) }); }
    response.writeHead(result.status, { "Content-Type": "application/json" }); response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const localUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const client = createPeerRequestClient({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "machine-base-local", pollMs: 1, requestId: () => id, fetchImpl: async (url, init) => String(url).startsWith("https://registry.test/") ? response({ items: [{ tunnelKey: "machine-base-peer", title: "https://peer.trycloudflare.com" }] }) : fetch(`${localUrl}${new URL(url).pathname}${new URL(url).search}`, init) });
    const result = await client.send("machine-base-peer", "READY");
    assert.equal(result.state, "completed");
    assert.equal(result.result, "echo:READY");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
