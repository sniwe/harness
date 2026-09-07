import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function prepareSetup({ root, identity, setupPath = path.join(root, "setup.json"), lockPath = path.join(root, "setup.lock"), pid = process.pid, now = Date.now() }) {
  fs.mkdirSync(root, { recursive: true });
  const lock = acquireLock(lockPath, pid, now);
  try {
    const saved = readJson(setupPath);
    if (saved?.phase === "ready" && saved.identity?.machineBaseId === identity.machineBaseId) return saved;
    const setup = {
      schemaVersion: 1,
      setupAttemptId: crypto.randomUUID(),
      phase: "ready",
      identity: { source: identity.source, algorithm: identity.algorithm, machineBaseId: identity.machineBaseId, tunnelKey: identity.tunnelKey },
      updatedAt: new Date(now).toISOString()
    };
    atomicWriteJson(setupPath, setup);
    return setup;
  } finally {
    fs.closeSync(lock.fd);
    fs.unlinkSync(lock.path);
  }
}

function acquireLock(lockPath, pid, now) {
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid, createdAt: now }));
    return { fd, path: lockPath };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = readJson(lockPath);
    const stale = !existing || now - Number(existing.createdAt || 0) > 10 * 60 * 1000 || !isProcessAlive(existing.pid);
    if (!stale) throw new Error(`machine_base_setup_locked path=${lockPath}`);
    fs.unlinkSync(lockPath);
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid, createdAt: now }));
    return { fd, path: lockPath };
  }
}

function isProcessAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}
