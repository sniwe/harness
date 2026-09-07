import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createTunnel } from "../src/tunnel.js";

test("tunnel publishes initial and rotated URLs from either stream", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false; child.kill = () => { child.killed = true; };
  const calls = [];
  const tunnel = createTunnel({ localUrl: "http://127.0.0.1:1", relayUrl: "http://relay", tunnelKey: "machine-base-test", childProcess: { spawn: () => child }, fetchImpl: async (_url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => "{}" }; }, logger: { info() {}, error() {} } });
  const ready = tunnel.start();
  child.stderr.write("https://first.trycloudflare.com\n");
  await ready;
  child.stdout.write("https://second.trycloudflare.com\n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(calls.map((x) => x.tunnelUrl), ["https://first.trycloudflare.com", "https://second.trycloudflare.com"]);
  tunnel.stop();
});

test("healthy tunnel process is relaunched after exit", async () => {
  const children = [];
  const spawnChild = () => { const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false; child.kill = () => { child.killed = true; }; children.push(child); return child; };
  const tunnel = createTunnel({ localUrl: "http://127.0.0.1:1", relayUrl: "http://relay", tunnelKey: "key", env: { TUNNEL_RETRY_DELAY_MS: "250" }, childProcess: { spawn: spawnChild }, fetchImpl: async () => ({ ok: true, status: 200, text: async () => "{}" }), logger: { info() {}, error() {} } });
  const ready = tunnel.start();
  children[0].stderr.write("https://stable.trycloudflare.com\n");
  await ready;
  children[0].emit("close", 1, null);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(children.length, 2);
  tunnel.stop();
});

test("relay publication is serialized so newer URLs win", async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false; child.kill = () => { child.killed = true; };
  const calls = [];
  let release;
  const first = new Promise((resolve) => { release = resolve; });
  const tunnel = createTunnel({ localUrl: "http://127.0.0.1:1", relayUrl: "http://relay", tunnelKey: "key", childProcess: { spawn: () => child }, fetchImpl: async (_url, init) => { const body = JSON.parse(init.body); calls.push(body.tunnelUrl); if (body.tunnelUrl.includes("one")) await first; return { ok: true, status: 200, text: async () => "{}" }; }, logger: { info() {}, error() {} } });
  const ready = tunnel.start();
  child.stderr.write("https://one.trycloudflare.com\n");
  child.stderr.write("https://two.trycloudflare.com\n");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, ["https://one.trycloudflare.com"]);
  release();
  await ready;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, ["https://one.trycloudflare.com", "https://two.trycloudflare.com"]);
  assert.equal(tunnel.state.publishedUrl, "https://two.trycloudflare.com");
  tunnel.stop();
});
