import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const relaunchCode = 75;
const maxLogBytes = 5 * 1024 * 1024;
const maxRecordBytes = 16 * 1024;

function redact(value) {
  return String(value).slice(0, maxRecordBytes)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,}]+/gi, "$1[redacted]")
    .replace(/(["']?(?:token|password|secret|apiKey|api_key)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[redacted]");
}

function ticketEnvironment(env) {
  return {
    ...env,
    TICKETS_BASE_URL: env.TICKETS_BASE_URL || 'https://dev-sitex2082572611.wixdev-sites.org',
    TICKETS_ENABLED: env.TICKETS_ENABLED || '1',
    TICKETS_WORKER_ENABLED: env.TICKETS_WORKER_ENABLED || '1',
    TICKETS_PROJECT_KEY: env.TICKETS_PROJECT_KEY || '',
    MACHINE_BASE_RUNTIME_CWD: env.MACHINE_BASE_RUNTIME_CWD || '',
    TICKETS_LOG_ROOT: env.TICKETS_LOG_ROOT || 'C:\\trendbase\\mgmt\\logs'
  };
}

export function createLauncherLogger({ dataRoot = path.resolve("data/machine-base"), fsImpl = fs, consoleImpl = console, maxBytes = maxLogBytes } = {}) {
  const logDir = path.resolve(dataRoot, "logs");
  const logPath = path.join(logDir, "launcher.log");
  let stream;
  let warned = false;
  function warnOnce(message) {
    if (warned) return;
    warned = true;
    consoleImpl.error?.(`[launcher] ${message}`);
  }
  try {
    fsImpl.mkdirSync(logDir, { recursive: true });
    if (fsImpl.existsSync(logPath) && fsImpl.statSync(logPath).size >= maxBytes) {
      const backup = `${logPath}.1`;
      try { fsImpl.rmSync(backup, { force: true }); } catch { /* best effort */ }
      fsImpl.renameSync(logPath, backup);
    }
    stream = fsImpl.createWriteStream(logPath, { flags: "a", encoding: "utf8" });
    stream.on("error", () => { warnOnce("launcher log write failed"); });
  } catch {
    warnOnce("launcher log unavailable");
  }
  function record(event, detail = "") {
    if (!stream?.writable) return;
    stream.write(`[${new Date().toISOString()}] ${event}${detail ? ` ${redact(detail)}` : ""}\n`, (error) => { if (error) warnOnce("launcher log write failed"); });
  }
  function childOutput(origin, chunk) { record(`child_${origin}`, chunk); }
  function close() {
    if (!stream) return Promise.resolve();
    return new Promise((resolve) => { stream.end(resolve); });
  }
  return { logPath, record, childOutput, close };
}

export function startLauncher({ env = process.env, spawnImpl = spawn, processImpl = process, logger = createLauncherLogger({ dataRoot: path.resolve(env.MACHINE_BASE_DATA_ROOT || "data/machine-base") }) } = {}) {
  const delayMs = Number(env.MACHINE_BASE_RELAUNCH_DELAY_MS || 1000);
  let generation = 0;
  let currentChild;
  let stopping = false;

  function run() {
    generation += 1;
    const child = currentChild = spawnImpl(processImpl.execPath, [fileURLToPath(new URL("./server.js", import.meta.url))], { stdio: ["ignore", "pipe", "pipe"], env: { ...ticketEnvironment(env), MACHINE_BASE_LAUNCH_GENERATION: String(generation) }, windowsHide: true });
    logger.record("spawn", `generation=${generation} pid=${child.pid}`);
    child.stdout?.on("data", (chunk) => { processImpl.stdout.write(chunk); logger.childOutput("stdout", chunk); });
    child.stderr?.on("data", (chunk) => { processImpl.stderr.write(chunk); logger.childOutput("stderr", chunk); });
    child.on("error", (error) => logger.record("child_error", error.message));
    child.on("exit", (code, signal) => {
      logger.record("exit", `generation=${generation} pid=${child.pid} code=${code} signal=${signal || "none"}`);
      if (code === relaunchCode && !stopping) {
        logger.record("relaunch_scheduled", `delayMs=${delayMs}`);
        return setTimeout(run, delayMs);
      }
      processImpl.exitCode = typeof code === "number" ? code : 1;
      if (signal) processImpl.exitCode = 1;
      void logger.close();
    });
    return child;
  }

  for (const signal of ["SIGINT", "SIGTERM"]) processImpl.once(signal, () => {
    if (stopping) return;
    stopping = true;
    logger.record("shutdown_signal", signal);
    currentChild?.kill(signal);
  });
  logger.record("launcher_start", `dataRoot=${env.MACHINE_BASE_DATA_ROOT || path.resolve("data/machine-base")} logPath=${logger.logPath}`);
  run();
  return { get child() { return currentChild; } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startLauncher();
