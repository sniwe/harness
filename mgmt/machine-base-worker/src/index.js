import { spawn } from "node:child_process";
import readline from "node:readline";
import { execFileSync } from "node:child_process";

const fake = process.env.MACHINE_BASE_FAKE === "1";
let codex;
let threadId;
let rpcId = 0;
let rpcWaiters = new Map();
let eventWaiters = [];
let turnQueue = Promise.resolve();

function log(message) { process.stderr.write(`[machine-base-worker] ${message}\n`); }

async function ensureCodex() {
  if (fake || threadId) return;
  const command = process.env.CODEX_BIN || (process.platform === "win32" ? `${process.env.APPDATA || ""}\\npm\\codex.cmd` : "codex");
  if (process.platform === "win32") {
    codex = spawn("cmd.exe", ["/d", "/s", "/c", command, "app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  } else codex = spawn(command, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"] });
  readline.createInterface({ input: codex.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (message.id && rpcWaiters.has(message.id)) { rpcWaiters.get(message.id)(message); rpcWaiters.delete(message.id); }
      if (message.method) {
        for (const waiter of [...eventWaiters]) if (waiter.method === message.method && (!waiter.id || message.params?.turn?.id === waiter.id || message.params?.turnId === waiter.id)) { eventWaiters = eventWaiters.filter((item) => item !== waiter); waiter.resolve(message); }
      }
    } catch { /* diagnostics are not protocol */ }
  });
  codex.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await rpc("initialize", { clientInfo: { name: "machine-base-worker", title: "Machine Base Worker", version: "1.0.0" } });
  codex.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);
  const started = await rpc("thread/start", { serviceName: "machine-base-worker", model: process.env.CODEX_MODEL || "gpt-5.6-luna", cwd: process.env.MACHINE_BASE_RUNTIME_CWD || process.cwd(), approvalPolicy: "never", sandbox: "workspace-write" });
  threadId = started?.result?.thread?.id || started?.result?.id;
  if (!threadId) throw new Error("codex_thread_start_missing_id");
  await turn("test");
}

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++rpcId;
    const timer = setTimeout(() => { rpcWaiters.delete(id); reject(new Error(`codex_rpc_timeout method=${method}`)); }, Number(process.env.CODEX_RPC_TIMEOUT_MS || 300000));
    rpcWaiters.set(id, (message) => { clearTimeout(timer); if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message); });
    codex.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function turn(prompt) {
  if (fake) return { res: prompt === "test" ? "ok" : prompt };
  const result = await rpc("turn/start", { threadId, model: process.env.CODEX_MODEL || "gpt-5.6-luna", effort: "low", input: [{ type: "text", text: prompt }], approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
  const turnId = result?.result?.turn?.id || result?.result?.id;
  if (!turnId) return result?.result || result;
  return (await waitEvent("turn/completed", turnId))?.params || result?.result || result;
}

function waitEvent(method, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { eventWaiters = eventWaiters.filter((item) => item.resolve !== resolve); reject(new Error(`codex_event_timeout method=${method}`)); }, Number(process.env.CODEX_RPC_TIMEOUT_MS || 300000));
    eventWaiters.push({ method, id, resolve: (value) => { clearTimeout(timer); resolve(value); }, reject });
  });
}

async function handle(payload) {
  await ensureCodex();
  if (payload.task === "remote-prompt") {
    if (typeof payload.prompt !== "string" || !payload.prompt.trim()) throw new Error("prompt_invalid");
    if (fake) return { ok: true, task: "remote-prompt", requestId: payload.requestId, result: "READY" };
    return { ok: true, task: "remote-prompt", requestId: payload.requestId, result: await turn(payload.prompt) };
  }
  if (payload.task === "check-project-commit") {
    if (!fake) await turn("Inspect the current project checkout with git and confirm its exact full commit hash, branch, and whether the worktree is clean. Return only the requested commit confirmation.");
    const root = process.env.MACHINE_BASE_REPO_ROOT || process.cwd();
    const run = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
    const commit = run(["rev-parse", "HEAD"]).toLowerCase();
    const branch = run(["branch", "--show-current"]);
    return { task: "check-project-commit", commit, branch, confirmed: /^[0-9a-f]{40}$/.test(commit) && Boolean(branch) };
  }
  return fake ? { ok: true, task: payload.task || "ping", machineBase: true } : turn(JSON.stringify(payload));
}

async function main() {
  log("startup");
  if (process.env.CODEX_WORKER_STREAMED !== "1") {
    const mode = process.argv[2] || "";
    const source = mode === "--payload" ? process.argv[3] : mode === "--file" ? await import("node:fs").then(({ readFileSync }) => readFileSync(process.argv[3], "utf8")) : mode || "{}";
    const payload = JSON.parse(source);
    process.stdout.write(`${JSON.stringify(await handle(payload))}\n`);
    codex?.stdin.end();
    codex?.kill();
    return;
  }
  await ensureCodex();
  log("ready");
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    turnQueue = turnQueue.then(async () => {
      try { process.stdout.write(`${JSON.stringify(await handle(JSON.parse(line)))}\n`); }
      catch (error) { log(error.stack || error.message || String(error)); process.stdout.write(`${JSON.stringify({ ok: false, error: error.message || String(error) })}\n`); }
    });
  });
}

main().catch((error) => { log(error.stack || error.message || String(error)); process.exitCode = 1; });
