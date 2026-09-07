import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createLauncherLogger, startLauncher } from "../src/launcher.js";

test("launcher logger records, redacts, and rotates diagnostics", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "machine-base-logs-"));
  const logger = createLauncherLogger({ dataRoot, maxBytes: 20 });
  logger.record("test", "https://user:password@example.test token=abc123");
  await logger.close();
  const text = fs.readFileSync(path.join(dataRoot, "logs", "launcher.log"), "utf8");
  assert.match(text, /^\[\d{4}-\d{2}-\d{2}T/);
  assert.match(text, /https:\/\/\[redacted\]@example\.test/);
  assert.match(text, /token=\[redacted\]/);

  const rotatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "machine-base-logs-"));
  fs.mkdirSync(path.join(rotatedRoot, "logs"));
  fs.writeFileSync(path.join(rotatedRoot, "logs", "launcher.log"), "1234567890");
  const rotated = createLauncherLogger({ dataRoot: rotatedRoot, maxBytes: 5 });
  rotated.record("after_rotation");
  await rotated.close();
  assert.equal(fs.readFileSync(path.join(rotatedRoot, "logs", "launcher.log.1"), "utf8"), "1234567890");
});

test("launcher tees child output and relaunches only on code 75", async () => {
  const children = [];
  const calls = [];
  const logger = { logPath: "test", record: (...args) => calls.push(["record", ...args]), childOutput: (...args) => calls.push(["output", ...args]), close: async () => {} };
  const processImpl = new EventEmitter();
  processImpl.execPath = "node";
  processImpl.stdout = { write() {} };
  processImpl.stderr = { write() {} };
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.pid = children.length + 10;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => child.emit("exit", null, signal);
    children.push(child);
    return child;
  };
  startLauncher({ env: { MACHINE_BASE_RELAUNCH_DELAY_MS: "1" }, spawnImpl, processImpl, logger });
  children[0].stdout.emit("data", "ready\\n");
  children[0].stderr.emit("data", "failure\\n");
  children[0].emit("exit", 75, null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(children.length, 2);
  assert.ok(calls.some(([kind, event]) => kind === "record" && event === "relaunch_scheduled"));
  assert.deepEqual(calls.filter(([kind]) => kind === "output").map(([, origin]) => origin), ["stdout", "stderr"]);
  processImpl.emit("SIGTERM");
  assert.equal(processImpl.exitCode, 1);
});
