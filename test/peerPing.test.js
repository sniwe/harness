import test from "node:test";
import assert from "node:assert/strict";
import { createPeerPing } from "../src/peerPing.js";

function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

test("looks up an exact peer and validates its tunnel URL", async () => {
  const calls = [];
  const client = createPeerPing({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "local", fetchImpl: async (url) => { calls.push(String(url)); return response({ items: [{ tunnelKey: "peer", title: "https://peer.trycloudflare.com" }], count: 1 }); } });
  assert.deepEqual(await client.lookup(" peer "), { tunnelKey: "peer", tunnelUrl: "https://peer.trycloudflare.com" });
  assert.equal(calls[0], "https://registry.test/_functions/tunnels?tunnelKey=peer");
});

test("pings the resolved peer and validates its identity", async () => {
  const calls = [];
  const client = createPeerPing({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "local", fetchImpl: async (url) => { calls.push(String(url)); return calls.length === 1 ? response({ items: [{ tunnelKey: "peer", title: "https://peer.trycloudflare.com" }], count: 1 }) : response({ ok: true, tunnelKey: "peer", serverRole: "machine-base", time: new Date().toISOString() }); } });
  const result = await client.ping("peer");
  assert.equal(result.ok, true);
  assert.equal(result.peer.tunnelKey, "peer");
  assert.deepEqual(calls, ["https://registry.test/_functions/tunnels?tunnelKey=peer", "https://peer.trycloudflare.com/api/machine-base/ping"]);
});

test("rejects local, missing, duplicate, and unsafe peers", async () => {
  const client = createPeerPing({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "local", fetchImpl: async () => response({ items: [] }) });
  await assert.rejects(() => client.lookup("local"), { status: 400, message: "cannot_ping_local_peer" });
  await assert.rejects(() => client.lookup("missing"), { status: 404, message: "peer_not_found" });
  const unsafe = createPeerPing({ registryUrl: "https://registry.test/_functions/tunnels", localKey: "local", fetchImpl: async () => response({ items: [{ tunnelKey: "peer", title: "http://peer.example" }] }) });
  await assert.rejects(() => unsafe.lookup("peer"), { status: 502, message: "peer_url_invalid" });
});
