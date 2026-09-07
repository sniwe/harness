import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createWorkerPool } from "../src/pool.js";

test("active and standby workers become ready and answer JSONL", async () => {
  const pool = createWorkerPool({ workerEntry: path.resolve("mgmt/machine-base-worker/src/index.js"), cwd: path.resolve("mgmt/machine-base-worker"), env: { ...process.env, MACHINE_BASE_FAKE: "1" } });
  await pool.start();
  assert.deepEqual(pool.slots.map((slot) => slot.state), ["ready", "ready"]);
  assert.deepEqual(await pool.request({ task: "ping" }), { ok: true, task: "ping", machineBase: true });
  pool.stop();
});

test("failed active worker fails over and is repaired", async () => {
  const pool = createWorkerPool({ workerEntry: path.resolve("mgmt/machine-base-worker/src/index.js"), cwd: path.resolve("mgmt/machine-base-worker"), env: { ...process.env, MACHINE_BASE_FAKE: "1" } });
  await pool.start();
  pool.slots[0].child.kill();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await pool.request({ task: "after-failure" }), { ok: true, task: "after-failure", machineBase: true });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(pool.slots[0].state, "ready");
  pool.stop();
});
