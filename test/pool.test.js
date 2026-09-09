import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createWorkerPool } from "../src/pool.js";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

test("active and standby workers become ready and answer JSONL", async () => {
  const pool = createWorkerPool({ workerEntry: path.resolve("mgmt/machine-base-worker/src/index.js"), cwd: path.resolve("mgmt/machine-base-worker"), env: { ...process.env, MACHINE_BASE_FAKE: "1" } });
  await pool.start();
  assert.deepEqual(pool.slots.map((slot) => slot.state), ["ready", "ready"]);
  const ping = await pool.request({ task: "ping" }); assert.equal(ping.ok, true); assert.equal(ping.task, "ping"); assert.equal(ping.machineBase, true); assert.ok(ping.execution.threadId); assert.ok(ping.execution.runtimeGeneration);
  const result = await pool.request({ task: "remote-prompt", requestId: "id", prompt: "anything" }); assert.equal(result.ok, true); assert.equal(result.status, "succeeded"); assert.equal(result.result, "READY"); assert.equal(result.execution.cwd, process.env.MACHINE_BASE_RUNTIME_CWD || path.resolve("mgmt/machine-base-worker"));
  pool.stop();
});

test("failed active worker fails over and is repaired", async () => {
  const pool = createWorkerPool({ workerEntry: path.resolve("mgmt/machine-base-worker/src/index.js"), cwd: path.resolve("mgmt/machine-base-worker"), env: { ...process.env, MACHINE_BASE_FAKE: "1" } });
  await pool.start();
  pool.slots[0].child.kill();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const result = await pool.request({ task: "after-failure" }); assert.equal(result.ok, true); assert.equal(result.task, "after-failure"); assert.equal(result.machineBase, true); assert.ok(result.execution.threadId); assert.ok(result.execution.runtimeGeneration);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(pool.slots[0].state, "ready");
  pool.stop();
});

test("pool startup can be cancelled while readiness remains indeterminate", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 77, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} }); const controller = new AbortController();
  const pool = createWorkerPool({ workerEntry: path.resolve("mgmt/machine-base-worker/src/index.js"), cwd: path.resolve("mgmt/machine-base-worker"), childProcess: { spawn: () => child }, logger: { info() {} } });
  const starting = pool.start({ signal: controller.signal }); controller.abort(); await assert.rejects(starting, /pool_start_cancelled/); assert.equal(pool.slots.every((slot) => slot.state === "stopped"), true);
});
