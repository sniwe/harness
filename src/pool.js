import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";

const MAX_WORKER_LINE_BYTES = 256 * 1024;

export function createWorkerPool({ workerEntry = path.resolve("mgmt/machine-base-worker/src/index.js"), cwd = path.dirname(workerEntry), env = process.env, childProcess = { spawn }, logger = console, readyWaitMs = 120000 } = {}) {
  const slots = [makeSlot("active"), makeSlot("standby")];
  let queue = Promise.resolve();

  function makeSlot(id) { return { id, state: "stopped", generation: 0, child: null, reader: null, ready: null, pending: null, lastError: "" }; }

  function spawnSlot(slot) {
    slot.generation += 1;
    slot.state = "starting";
    slot.ready = new Promise((resolve, reject) => { slot.resolveReady = resolve; slot.rejectReady = reject; });
    slot.child = childProcess.spawn(process.execPath, [workerEntry], { cwd, env: { ...env, CODEX_WORKER_STREAMED: "1", CODEX_WORKER_SLOT: slot.id }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    slot.reader = readline.createInterface({ input: slot.child.stderr });
    slot.reader.on("line", (line) => { logger.info?.(`[worker:${slot.id}] ${line}`); if (line.includes("[machine-base-worker] ready")) { slot.state = "ready"; slot.resolveReady(); } });
    const stdout = readline.createInterface({ input: slot.child.stdout });
    slot.stdout = stdout;
    stdout.on("line", (line) => { if (!slot.pending) return; const pending = slot.pending; slot.pending = null; let value; try { if (Buffer.byteLength(line, "utf8") > MAX_WORKER_LINE_BYTES) throw new Error("worker_result_too_large"); value = JSON.parse(line); if (pending.requestId && value?.requestId !== pending.requestId) throw new Error("worker_result_id_mismatch"); } catch (error) { pending.reject(error); failSlot(slot, error); return; } pending.resolve(value); });
    slot.child.on("error", (error) => failSlot(slot, error));
    slot.child.on("close", (code, signal) => { if (slot.state !== "stopped") failSlot(slot, new Error(`worker_exit slot=${slot.id} code=${code} signal=${signal}`)); });
    return slot.ready;
  }

  function failSlot(slot, error) {
    if (slot.state === "failed") return;
    slot.lastError = error.message;
    slot.state = "failed";
    slot.rejectReady?.(error);
    slot.pending?.reject(error);
    slot.pending = null;
    slot.reader?.close();
    slot.stdout?.close();
    if (slot.child && !slot.child.killed) slot.child.kill();
    setTimeout(() => { if (slot.state === "failed") { try { spawnSlot(slot); } catch (repairError) { slot.lastError = repairError.message; } } }, 250);
  }
  async function start() { await Promise.all(slots.map(spawnSlot)); }
  function readySlot() { return slots.find((slot) => slot.state === "ready"); }
  async function request(payload) {
    const work = queue.catch(() => {}).then(async () => {
      let slot = readySlot();
      if (!slot) throw new Error("no_worker_ready");
      try { return await send(slot, payload); }
      catch (error) {
        failSlot(slot, error);
        if (payload.task === "remote-prompt") throw error;
        slot = readySlot();
        if (!slot) throw error;
        return send(slot, payload);
      }
    });
    queue = work.catch(() => {});
    return work;
  }
  function send(slot, payload) {
    return new Promise((resolve, reject) => {
      slot.pending = { requestId: payload.requestId, resolve, reject };
      try { slot.child.stdin.write(`${JSON.stringify(payload)}\n`); } catch (error) { slot.pending.reject(error); }
    });
  }
  function stop() { slots.forEach((slot) => { slot.state = "stopped"; slot.reader?.close(); slot.stdout?.close(); if (slot.child && !slot.child.killed) slot.child.kill(); }); }
  return { start, request, stop, slots };
}
