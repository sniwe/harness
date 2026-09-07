import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { deriveMachineIdentity } from "./machineIdentity.js";
import { createTunnel } from "./tunnel.js";
import { createWorkerPool } from "./pool.js";
import { prepareSetup } from "./setup.js";

const root = path.resolve(process.env.MACHINE_BASE_DATA_ROOT || "data/machine-base");
const identityPath = path.join(root, "identity.json");
const setupPath = path.join(root, "setup.json");
const port = Number(process.env.PORT || 3100);
const relayBaseUrl = String(process.env.TUNNEL_RELAY_BASE_URL || "").replace(/\/+$/, "");
const relayUrl = relayBaseUrl ? `${relayBaseUrl}${process.env.TUNNEL_RELAY_PATH || "/_functions/tunnelRelay"}` : "";
const localUrl = process.env.TUNNEL_RELAY_LOCAL_URL || `http://127.0.0.1:${port}`;

fs.mkdirSync(root, { recursive: true });
const identity = deriveMachineIdentity({ env: { ...process.env, MACHINE_BASE_IDENTITY_PATH: identityPath } });
if (!fs.existsSync(identityPath)) fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2));
const setup = prepareSetup({ root, identity, setupPath });

const pool = createWorkerPool({ env: process.env, workerEntry: path.resolve("mgmt/machine-base-worker/src/index.js"), cwd: path.resolve("mgmt/machine-base-worker") });
const tunnel = relayUrl ? createTunnel({ localUrl, relayUrl, tunnelKey: process.env.TUNNEL_KEY || identity.tunnelKey }) : null;
let server;

function json(response, status, body) { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); }
function readBody(request) { return new Promise((resolve, reject) => { let text = ""; request.on("data", (chunk) => { text += chunk; if (text.length > 1024 * 1024) reject(new Error("body_too_large")); }); request.on("end", () => resolve(text)); request.on("error", reject); }); }

server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true, pid: process.pid, tunnel: tunnel?.state || null });
    if (request.method === "GET" && request.url === "/status") return json(response, 200, { ok: true, setup, identity: { source: identity.source, machineBaseId: identity.machineBaseId, tunnelKey: process.env.TUNNEL_KEY || identity.tunnelKey }, tunnel: tunnel?.state || null, workers: pool.slots.map(({ child, reader, stdout, ...slot }) => slot) });
    if (request.method === "GET" && request.url === "/setup/status") return json(response, 200, setup);
    if (request.method === "POST" && request.url === "/api/machine-base/request") {
      const payload = JSON.parse(await readBody(request));
      return json(response, 200, await pool.request(payload));
    }
    json(response, 404, { ok: false, error: "not_found" });
  } catch (error) { json(response, error.message === "body_too_large" ? 413 : 400, { ok: false, error: error.message || String(error) }); }
});

async function start() {
  await pool.start();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  if (tunnel) await tunnel.start();
  console.log(JSON.stringify({ ready: true, pid: process.pid, port, tunnelKey: process.env.TUNNEL_KEY || identity.tunnelKey, tunnel: tunnel?.state || null }));
}
async function stop() { tunnel?.stop(); pool.stop(); await new Promise((resolve) => server?.close(() => resolve())); }
process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
if (process.env.MACHINE_BASE_NO_START !== "1") start().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });

export { server, start, stop, identity, setup };
