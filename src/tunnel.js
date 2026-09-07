import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?:\/[^^\s"'<>)]*)?/i;

export function createTunnel({ localUrl, relayUrl, tunnelKey, env = process.env, childProcess = { spawn }, fetchImpl = fetch, logger = console } = {}) {
  let child = null;
  let readers = [];
  let observedUrl = "";
  let publishedUrl = "";
  let lastError = "";
  let stopped = false;
  let publishQueue = Promise.resolve();
  let readySettled = false;
  const retryDelayMs = Math.max(250, Number(env.TUNNEL_RETRY_DELAY_MS || 15000));
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  async function publishOne(url) {
    if (!url || url === publishedUrl || stopped) return;
    try {
      const response = await fetchImpl(relayUrl, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ tunnelKey, tunnelUrl: url }) });
      const body = await response.text();
      if (!response.ok) throw new Error(`relay_failed status=${response.status} body=${body}`);
      publishedUrl = url;
      logger.info?.(`[tunnel] published key=${tunnelKey} url=${url}`);
      if (!readySettled) { readySettled = true; resolveReady({ tunnelUrl: url, status: response.status }); }
    } catch (error) {
      lastError = error.message || String(error);
      logger.error?.(`[tunnel] ${lastError}`);
      if (!readySettled) { readySettled = true; rejectReady(error); }
    }
  }

  function publish(url) {
    const normalized = String(url || "").trim();
    if (!normalized || normalized === observedUrl || stopped) return;
    observedUrl = normalized;
    publishQueue = publishQueue.then(() => publishOne(normalized));
  }

  function line(text) {
    const match = String(text).match(URL_RE);
    if (match) void publish(new URL(match[0]).origin);
  }

  function launch() {
    const command = resolveCloudflaredCommand(env);
    child = childProcess.spawn(command, ["tunnel", "--url", localUrl, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    readers = [readline.createInterface({ input: child.stdout }), readline.createInterface({ input: child.stderr })];
    readers.forEach((reader) => reader.on("line", line));
    child.on("error", (error) => { lastError = error.message; if (!publishedUrl) rejectReady(error); });
    child.on("close", (code, signal) => {
      child = null;
      if (stopped) return;
      if (!publishedUrl) rejectReady(new Error(`cloudflared_exited code=${code} signal=${signal}`));
      else setTimeout(() => { if (!stopped && !child) launch(); }, retryDelayMs);
    });
  }

  function start() {
    if (!child) launch();
    return ready;
  }

  function stop() {
    stopped = true;
    readers.forEach((reader) => reader.close());
    readers = [];
    if (child && !child.killed) child.kill();
    child = null;
  }

  return { start, stop, ready, get state() { return { observedUrl, publishedUrl, lastError, running: Boolean(child && !child.killed) }; } };
}

export function resolveCloudflaredCommand(env = process.env, platform = process.platform, lookup = spawnSync) {
  if (String(env.CLOUDFLARED_PATH || "").trim()) return String(env.CLOUDFLARED_PATH).trim();
  if (platform === "win32") {
    try {
      const result = lookup("where.exe", ["cloudflared.exe"], { encoding: "utf8", windowsHide: true });
      const path = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (path) return path;
    } catch { /* fall through to PATH lookup */ }
    return "cloudflared.exe";
  }
  return "cloudflared";
}
