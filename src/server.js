import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { deriveMachineIdentity } from "./machineIdentity.js";
import { createTunnel } from "./tunnel.js";
import { createWorkerPool } from "./pool.js";
import { prepareSetup } from "./setup.js";
import { createPeerPing } from "./peerPing.js";
import { captureStartupLaunch, isSafeBranch, readCheckout, readRemoteSnapshot, syncCheckout, verifyLaunchRevalidation } from "./commit.js";
import { coordinatePeers, createCommitSyncClient } from "./commitSync.js";
import { createPeerRequestClient, createPeerRequestHandler } from "./peerRequest.js";
import crypto from "node:crypto";
import { createTicketClient } from "./ticketClient.js";
import { readTicketIdentity } from "./ticketIdentity.js";
import { createTicketLog } from "./ticketLog.js";
import { createTicketJournal } from "./ticketJournal.js";
import { createTicketCleanup } from "./ticketCleanup.js";
import { createTicketReconciler } from "./ticketReconciler.js";
import { createTicketWorker } from "./ticketWorker.js";
import { readTicketProject } from "./ticketProjects.js";
import { createAttemptStore } from "./attemptStore.js";
import { createOperationOutbox } from "./operationOutbox.js";
import { createArtifactTransferHandler } from "./artifactTransfer.js";

const root = path.resolve(process.env.MACHINE_BASE_DATA_ROOT || "data/machine-base");
const repoRoot = path.resolve(process.env.MACHINE_BASE_REPO_ROOT || process.cwd());
const branch = process.env.MACHINE_BASE_GIT_BRANCH || "main";
const identityPath = path.join(root, "identity.json");
const setupPath = path.join(root, "setup.json");
const configuredPort = Number.isInteger(Number(process.env.PORT)) ? Math.max(0, Number(process.env.PORT)) : 3100;
const runtimeCwd = process.env.MACHINE_BASE_RUNTIME_CWD || "";
if (!runtimeCwd) throw new Error("runtime_cwd_required");
const relayBaseUrl = process.env.TUNNEL_DISABLED === "1" ? "" : String(process.env.TUNNEL_RELAY_BASE_URL || "https://dev-sitex2082572611.wixdev-sites.org/").replace(/\/+$/, "");
const relayUrl = relayBaseUrl ? `${relayBaseUrl}${process.env.TUNNEL_RELAY_PATH || "/_functions/tunnelRelay"}` : "";

fs.mkdirSync(root, { recursive: true });
const identity = deriveMachineIdentity({ env: { ...process.env, MACHINE_BASE_IDENTITY_PATH: identityPath } });
if (!fs.existsSync(identityPath)) fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2));
const setup = prepareSetup({ root, identity, setupPath });
const peerPing = createPeerPing({ registryUrl: `${relayBaseUrl}/_functions/tunnels`, localKey: process.env.TUNNEL_KEY || identity.tunnelKey });
const configuredCheckout = readCheckout({ repoRoot });
if (!isSafeBranch(branch) || branch !== configuredCheckout.branch) throw new Error("configured_branch_mismatch");
const configuredOrigin = process.env.MACHINE_BASE_GIT_ORIGIN || configuredCheckout.origin;
if (configuredOrigin !== configuredCheckout.origin) throw new Error("configured_origin_mismatch");
const runId = process.env.MACHINE_BASE_RUN_ID || crypto.randomUUID();
const generation = Number(process.env.MACHINE_BASE_LAUNCH_GENERATION || 1);
let launchRemote = null;
let launchTrustFailure = null;
let launchCheckout = configuredCheckout;
let launch;
try {
  launchRemote = readRemoteSnapshot({ repoRoot, branch });
  launchCheckout = readCheckout({ repoRoot });
  launch = { ...captureStartupLaunch({ runId, generation, checkout: launchCheckout, remote: launchRemote, branch }), capturedAt: new Date().toISOString() };
  launchTrustFailure = launch.trustFailure || null;
} catch (error) {
  if (!launchRemote) {
    launchTrustFailure = { error: error.message || "github_check_failed", launchCommit: launchCheckout.commit, remoteCommit: error.advertisedCommit || null, fetchedCommit: error.fetchedCommit || null };
  } else throw error;
  launch = { runId, generation, ...launchCheckout, remoteCommit: launchRemote?.commit || null, remoteObservedAt: launchRemote?.observedAt || null, trust: "startup-unverified", trustFailure: launchTrustFailure, capturedAt: new Date().toISOString() };
}
const commitSync = createCommitSyncClient({ registryUrl: `${relayBaseUrl}/_functions/tunnels` });
const machineKey = process.env.TUNNEL_KEY || identity.tunnelKey;
const peerRequestClient = createPeerRequestClient({ registryUrl: `${relayBaseUrl}/_functions/tunnels`, localKey: machineKey, callerKey: machineKey });

const pool = createWorkerPool({ env: { ...process.env, MACHINE_BASE_REPO_ROOT: repoRoot, MACHINE_BASE_RUNTIME_CWD: runtimeCwd }, workerEntry: path.resolve("mgmt/machine-base-worker/src/index.js"), cwd: path.resolve("mgmt/machine-base-worker") });
const peerRequestHandler = createPeerRequestHandler({ pool, targetKey: machineKey, enabled: process.env.MACHINE_BASE_REMOTE_PROMPTS_ENABLED !== "0", maxInFlight: 1 });
const artifactTransferHandler = createArtifactTransferHandler({ root: process.env.MACHINE_BASE_ARTIFACT_ROOT || path.join(root, "artifacts"), targetKey: machineKey, enabled: process.env.MACHINE_BASE_ARTIFACT_TRANSFER_ENABLED !== "0" });
let port = configuredPort;
let localUrl = "";
let tunnel = null;
let server;
let startupState = "starting";
let localCommitConfirmation = null;
let coordination = null;
let coordinationTimer = null;
let syncInProgress = false;
let stopping = false;
let ticketRuntime = null;
let ticketStop = null;

function configureTickets() {
  const ticketEnv = { ...process.env, TICKETS_BASE_URL: process.env.TICKETS_BASE_URL || "https://dev-sitex2082572611.wixdev-sites.org", TICKETS_ENABLED: process.env.TICKETS_ENABLED || "0", TICKETS_WORKER_ENABLED: process.env.TICKETS_WORKER_ENABLED || "0", TICKETS_PROJECT_KEY: process.env.TICKETS_PROJECT_KEY || "", MACHINE_BASE_RUNTIME_CWD: runtimeCwd, TICKETS_LOG_ROOT: process.env.TICKETS_LOG_ROOT || "C:\\trendbase\\mgmt\\logs" };
  if (ticketEnv.TICKETS_ENABLED !== "1" || !ticketEnv.TICKETS_BASE_URL) return null;
  const identity = readTicketIdentity({ env: ticketEnv });
  const project = readTicketProject(identity.projectKey);
  const normalizeCwd = (value) => value.toLowerCase().replace(/[\\/]+/g, "\\").replace(/\\+$/, "");
  if (normalizeCwd(project.root) !== normalizeCwd(runtimeCwd)) throw new Error("ticket_runtime_cwd_mismatch");
  const log = createTicketLog({ root: identity.logRoot, machineKey: identity.machineKey, projectKey: identity.projectKey });
  const client = createTicketClient({ baseUrl: ticketEnv.TICKETS_BASE_URL });
  const journal = createTicketJournal(path.join(identity.logRoot, "tickets", "journal", identity.projectKey, `${identity.machineKey}.jsonl`));
  const cleanup = createTicketCleanup({ client, journal });
  const runRoot = path.join(identity.logRoot, "runs", runId);
  const worker = ticketEnv.TICKETS_WORKER_ENABLED === "1" ? createTicketWorker({ client, pool, identity, projectRoot: project.root, log: (event) => log.append(event), journal, lockRoot: path.join(identity.logRoot, "tickets", "locks"), attemptStore: createAttemptStore(runRoot), operationOutbox: createOperationOutbox(runRoot), leaseRoot: path.join(identity.logRoot, "projects") }) : null;
  const onReceipt = async (receipt) => { log.append({ event: 'receipt_observed', ticketId: receipt.ticketId, parentTicketId: receipt.parentTicketId, outcomeHash: receipt.outcomeHash }); const source = await client.get(receipt.sourceTicketId); if (!['completed', 'failed'].includes(source.ticket.status) || source.ticket.receiptTicketId !== receipt.ticketId || source.ticket.outcomeHash !== receipt.outcomeHash) throw new Error('receipt_source_not_final'); const current = await client.get(receipt.ticketId); const operationId = `ack:${receipt.ticketId}`; journal.append({ event: 'mutation_intent', action: 'ack', ticketId: receipt.ticketId, operationId, expectedRevision: current.ticket.revision }); try { await client.mutate(receipt.ticketId, { operationId, expectedRevision: current.ticket.revision, previousHash: current.ticket.headHash, actor: identity, action: 'ack', data: { outcomeHash: receipt.outcomeHash } }); journal.append({ event: 'mutation_result', action: 'ack', ticketId: receipt.ticketId, operationId, outcome: 'acknowledged' }); log.append({ event: 'receipt_acked', ticketId: receipt.ticketId, parentTicketId: receipt.parentTicketId }); } catch (error) { journal.append({ event: 'mutation_result', action: 'ack', ticketId: receipt.ticketId, operationId, outcome: 'error', error: error.message }); throw error; } };
  const reconciler = createTicketReconciler({ client, identity, log: (event) => log.append(event), cursorFile: path.join(identity.logRoot, 'tickets', 'cursor', `${identity.projectKey}.json`), onTicket: worker ? (ticket) => worker.run(ticket) : undefined, onReceipt, onMaintenance: async () => { try { await worker?.recover(); await cleanup.resumePending(); } catch (error) { log.append({ event: 'cleanup_resume_failed', error: error.message }); } } });
  return { identity, reconciler, worker, cleanup, log, enabled: true };
}

function json(response, status, body) { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); }
function readBody(request, maxBytes = 1024 * 1024) { return new Promise((resolve, reject) => { let text = ""; let rejected = false; request.on("data", (chunk) => { if (rejected) return; text += chunk; if (Buffer.byteLength(text, "utf8") > maxBytes) { rejected = true; reject(new Error("body_too_large")); } }); request.on("end", () => { if (!rejected) resolve(text); }); request.on("error", (error) => { if (!rejected) reject(error); }); }); }
async function commitStatus() { const result = await pool.request({ task: "check-project-commit" }); return { commit: { ...launch, confirmed: result.commit === launch.commit && result.branch === launch.branch && result.confirmed === true }, worker: result, tunnel: tunnel?.state || null, generation: launch.generation }; }
async function coordinate() {
  if (launchTrustFailure) return { ok: false, skipped: launchTrustFailure.error, target: launch, trustFailure: launchTrustFailure };
  let current;
  let remote;
  try {
    current = readCheckout({ repoRoot });
    remote = readRemoteSnapshot({ repoRoot, branch });
  } catch (error) {
    return { ok: false, skipped: error.message || "local_commit_target_untrusted", target: launch, trustFailure: { error: error.message || "trust_check_failed", launchCommit: launch.commit, remoteCommit: remote?.commit || null, fetchedCommit: error.fetchedCommit || null, advertisedCommit: error.advertisedCommit || null } };
  }
  try { verifyLaunchRevalidation({ checkout: current, remote, launch, branch }); }
  catch (error) { return { ok: false, skipped: error.message, target: launch, trustFailure: { error: error.message, launchCommit: launch.commit, remoteCommit: remote.commit, remoteObservedAt: remote.observedAt } }; }
  const items = await commitSync.list();
  return coordinatePeers({ client: commitSync, peerKeys: items.map((item) => item.tunnelKey).filter((key) => typeof key === "string" && key.startsWith("machine-base-")), localKey: process.env.TUNNEL_KEY || identity.tunnelKey, target: { runId: launch.runId, commit: launch.commit, branch } });
}

server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (request.method === "GET" && pathname === "/health") return json(response, 200, { ok: true, pid: process.pid, runId: launch.runId, commit: launch.commit, branch: launch.branch, runtimeGeneration: `${launch.commit}:${launch.generation}`, tunnel: tunnel?.state || null });
    if (request.method === "GET" && pathname === "/status") return json(response, 200, { ok: true, setup, identity: { source: identity.source, machineBaseId: identity.machineBaseId, tunnelKey: machineKey }, launch, startupState, localCommitConfirmation, coordination, peerRequest: peerRequestHandler.state, artifactTransfer: artifactTransferHandler.state, ticket: ticketRuntime ? { enabled: true, machineKey: ticketRuntime.identity.machineKey, projectKey: ticketRuntime.identity.projectKey, logRoot: ticketRuntime.identity.logRoot } : { enabled: false }, tunnel: tunnel?.state || null, workers: pool.slots.map(({ child, reader, stdout, ...slot }) => slot) });
    if (request.method === "GET" && pathname === "/setup/status") return json(response, 200, setup);
    if (request.method === "GET" && pathname === "/api/machine-base/ping") return json(response, 200, { ok: true, tunnelKey: process.env.TUNNEL_KEY || identity.tunnelKey, serverRole: "machine-base", time: new Date().toISOString() });
    if (request.method === "POST" && pathname === "/api/machine-base/peer-ping") return json(response, 200, await peerPing.ping(JSON.parse(await readBody(request)).tunnelKey));
    if (request.method === "POST" && pathname === "/api/machine-base/commit-status") {
      return json(response, 200, { ok: true, ...(await commitStatus()) });
    }
    if (request.method === "POST" && pathname === "/api/machine-base/commit-sync") {
      if (syncInProgress) return json(response, 409, { ok: false, error: "sync_in_progress" });
      const payload = JSON.parse(await readBody(request));
      if (!/^[0-9a-f]{40}$/.test(payload.expectedCommit || "") || payload.branch !== branch || !payload.runId) return json(response, 400, { ok: false, error: "sync_request_invalid" });
      const current = readCheckout({ repoRoot });
      if (current.origin !== configuredOrigin) return json(response, 409, { ok: false, error: "configured_origin_mismatch" });
      let advertised;
      try { advertised = readRemoteSnapshot({ repoRoot, branch }); } catch (error) { return json(response, 409, { ok: false, error: error.message || "origin_tip_unstable" }); }
      if (advertised.commit !== payload.expectedCommit) return json(response, 409, { ok: false, error: "commit_not_origin_tip", advertisedCommit: advertised.commit });
      if (payload.expectedCommit === launch.commit) return json(response, 200, { ok: true, state: "already_current", ...(await commitStatus()) });
      syncInProgress = true;
      try {
        const updated = syncCheckout({ repoRoot, expectedCommit: payload.expectedCommit, branch });
        const confirmation = await pool.request({ task: "check-project-commit" });
        if (confirmation.commit !== updated.commit || confirmation.commit !== payload.expectedCommit || confirmation.confirmed !== true) throw new Error("post_pull_commit_denied");
        fs.writeFileSync(path.join(root, "relaunch.json"), JSON.stringify({ runId: payload.runId, expectedCommit: payload.expectedCommit, generation: launch.generation + 1, createdAt: new Date().toISOString() }, null, 2));
        json(response, 202, { ok: true, state: "relaunching", runId: payload.runId, expectedCommit: payload.expectedCommit });
        setTimeout(() => void stop().then(() => process.exit(75)), 25);
        return;
      } finally { syncInProgress = false; }
    }
    if (request.method === "POST" && pathname === "/api/machine-base/peer-request") {
      const payload = JSON.parse(await readBody(request, 64 * 1024));
      const result = await peerRequestHandler.handle({ headers: request.headers, payload });
      return json(response, result.status, result.body);
    }
    if (request.method === "GET" && pathname === "/api/machine-base/peer-request-status") {
      const url = new URL(request.url, "http://127.0.0.1");
      const result = peerRequestHandler.status({ requestId: url.searchParams.get("requestId"), targetKey: url.searchParams.get("targetTunnelKey") });
      return json(response, result.status, result.body);
    }
    if (request.method === "POST" && pathname === "/api/machine-base/artifact-chunk") {
      const result = artifactTransferHandler.handle(JSON.parse(await readBody(request, 512 * 1024)));
      return json(response, result.status, result.body);
    }
    if (request.method === "POST" && pathname === "/api/machine-base/peer-request-send") {
      if (process.env.MACHINE_BASE_PEER_REQUEST_SENDER_ENABLED === "0") return json(response, 403, { ok: false, error: "peer_sender_disabled" });
      const payload = JSON.parse(await readBody(request, 64 * 1024));
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((key) => !["tunnelKey", "prompt"].includes(key))) return json(response, 400, { ok: false, error: "sender_request_fields_invalid" });
      const result = await peerRequestClient.send(payload.tunnelKey, payload.prompt);
      return json(response, 200, result);
    }
    if (request.method === "POST" && pathname === "/api/machine-base/request") {
      if (process.env.MACHINE_BASE_LOCAL_WORKER_REQUEST_ENABLED !== "1") return json(response, 403, { ok: false, error: "local_worker_route_disabled" });
      const payload = JSON.parse(await readBody(request));
      return json(response, 200, await pool.request(payload));
    }
    if (request.method === "POST" && pathname === "/api/machine-base/tickets/reconcile") {
      if (!ticketRuntime) return json(response, 403, { ok: false, error: "tickets_disabled" });
      return json(response, 200, await ticketRuntime.reconciler.once());
    }
    json(response, 404, { ok: false, error: "not_found" });
  } catch (error) { json(response, error.message === "body_too_large" ? 413 : error.status || 400, { ok: false, error: error.message || String(error) }); }
});

async function start() {
  await pool.start();
  startupState = "workers_ready";
  localCommitConfirmation = await pool.request({ task: "check-project-commit" });
  if (localCommitConfirmation.commit !== launch.commit || localCommitConfirmation.branch !== launch.branch || localCommitConfirmation.confirmed !== true) throw new Error("local_commit_confirmation_failed");
  startupState = "local_commit_confirmed";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(configuredPort, "127.0.0.1", () => {
      server.off("error", reject);
      port = server.address().port;
      const configuredLocalUrl = String(process.env.TUNNEL_RELAY_LOCAL_URL || "").trim();
      if (configuredLocalUrl) {
        const url = new URL(configuredLocalUrl);
        if (configuredPort === 0) url.port = String(port);
        localUrl = url.toString().replace(/\/$/, "");
      } else localUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
  tunnel = relayUrl ? createTunnel({ localUrl, relayUrl, tunnelKey: process.env.TUNNEL_KEY || identity.tunnelKey }) : null;
  if (tunnel) await tunnel.start();
  ticketRuntime = configureTickets();
  if (ticketRuntime) { await ticketRuntime.reconciler.once(); ticketStop = ticketRuntime.reconciler.start(); }
  startupState = "tunnel_ready";
  if (process.env.MACHINE_BASE_COORDINATE_ON_START !== "0") { startupState = "peers_checking"; coordination = await coordinate(); startupState = coordination.ok ? "converged" : launchTrustFailure ? "started_unverified" : "coordination_failed"; if (!coordination.ok && !launchTrustFailure) { coordinationTimer = setInterval(async () => { if (stopping || syncInProgress) return; try { const result = await coordinate(); coordination = result; if (result.ok) { startupState = "converged"; clearInterval(coordinationTimer); coordinationTimer = null; } } catch (error) { coordination = { ok: false, error: error.message }; } }, 30000); } }
  console.log(JSON.stringify({ ready: true, pid: process.pid, port, tunnelKey: process.env.TUNNEL_KEY || identity.tunnelKey, tunnel: tunnel?.state || null }));
}
async function stop() {
  if (stopping) return;
  stopping = true;
  if (coordinationTimer) { clearInterval(coordinationTimer); coordinationTimer = null; }
  tunnel?.stop();
  ticketStop?.();
  pool.stop();
  await new Promise((resolve) => {
    if (!server?.listening) return resolve();
    server.close(() => resolve());
    server.closeIdleConnections?.();
  });
}
process.once("SIGINT", () => void stop().then(() => process.exit(0)));
process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
if (process.env.MACHINE_BASE_NO_START !== "1") start().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });

export { server, start, stop, identity, setup };
