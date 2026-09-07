import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createPeerRequestClient, createPeerRequestHandler, validateRemotePromptEnvelope } from "../src/peerRequest.js";

const id = "11111111-1111-4111-8111-111111111111";
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

test("remote prompt envelope is strict and bounded", () => {
  assert.deepEqual(validateRemotePromptEnvelope({ requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY", timeoutMs: 999999 }, { targetKey: "machine-base-peer" }).timeoutMs, 120000);
  assert.throws(() => validateRemotePromptEnvelope({ requestId: id, targetTunnelKey: "machine-base-other", prompt: "READY" }, { targetKey: "machine-base-peer" }), /target_key_invalid/);
  assert.throws(() => validateRemotePromptEnvelope({ requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY", cwd: "C:\\" }, { targetKey: "machine-base-peer" }), /request_fields_invalid/);
});

test("peer sender resolves exact key and posts only the fixed route", async () => {
  const calls = [];
  const client = createPeerRequestClient({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "machine-base-local", callerKey: "machine-base-local", requestId: () => id, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return calls.length === 1 ? response({ items: [{ tunnelKey: "machine-base-peer", title: "https://peer.trycloudflare.com" }] }) : response({ ok: true, requestId: id, callerKey: "machine-base-local", targetKey: "machine-base-peer", state: "completed", result: "READY" });
  } });
  const result = await client.send("machine-base-peer", "Return exactly READY.");
  assert.equal(result.result, "READY");
  assert.equal(calls[1].url, "https://peer.trycloudflare.com/api/machine-base/peer-request");
  assert.equal(calls[1].init.headers["X-Machine-Base-Caller-Key"], "machine-base-local");
  assert.equal(JSON.parse(calls[1].init.body).targetTunnelKey, "machine-base-peer");
});

test("peer handler executes one bounded worker task and rejects replay", async () => {
  const calls = [];
  const pool = { request: async (payload, timeoutMs) => { calls.push({ payload, timeoutMs }); return { ok: true, task: "remote-prompt", requestId: payload.requestId, result: "READY" }; } };
  const handler = createPeerRequestHandler({ pool, targetKey: "machine-base-peer", enabled: true, now: (() => { let n = 0; return () => `t${++n}`; })() });
  const result = await handler.handle({ headers: { "x-machine-base-caller-key": "machine-base-local" }, payload: { requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY" } });
  assert.equal(result.status, 200);
  assert.equal(result.body.state, "completed");
  assert.equal(result.body.result, "READY");
  assert.equal(calls[0].payload.task, "remote-prompt");
  assert.equal(calls[0].payload.prompt, "READY");
  assert.equal((await handler.handle({ headers: {}, payload: { requestId: id, targetTunnelKey: "machine-base-peer", prompt: "READY" } })).body.error, "request_already_completed");
});

test("peer handler enforces in-flight capacity and never exposes prompt in state", async () => {
  let release;
  const pool = { request: () => new Promise((resolve) => { release = resolve; }) };
  const handler = createPeerRequestHandler({ pool, targetKey: "peer", enabled: true, maxInFlight: 1 });
  const first = handler.handle({ headers: { "x-machine-base-caller-key": "local" }, payload: { requestId: id, targetTunnelKey: "peer", prompt: "PRIVATE" } });
  const second = await handler.handle({ headers: { "x-machine-base-caller-key": "local" }, payload: { requestId: "22222222-2222-4222-8222-222222222222", targetTunnelKey: "peer", prompt: "PRIVATE-2" } });
  assert.equal(second.status, 429);
  assert.equal(JSON.stringify(handler.state).includes("PRIVATE"), false);
  release({ result: "READY" });
  assert.equal((await first).status, 200);
});

test("local sender and peer handler complete one HTTP prompt round trip", async () => {
  const handler = createPeerRequestHandler({ pool: { request: async ({ task, prompt, requestId }) => ({ ok: true, task, requestId, result: `echo:${prompt}` }) }, targetKey: "machine-base-peer", enabled: true });
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const result = await handler.handle({ headers: request.headers, payload: JSON.parse(body) });
    response.writeHead(result.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(result.body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const localUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const client = createPeerRequestClient({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "machine-base-local", requestId: () => id, fetchImpl: async (url, init) => {
      if (String(url).startsWith("https://registry.test/")) return response({ items: [{ tunnelKey: "machine-base-peer", title: "https://peer.trycloudflare.com" }] });
      return fetch(`${localUrl}/api/machine-base/peer-request`, init);
    } });
    const result = await client.send("machine-base-peer", "READY");
    assert.equal(result.state, "completed");
    assert.equal(result.result, "echo:READY");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
