import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareSetup } from "../src/setup.js";

test("setup manifest is reused and stale lock is recovered", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "machine-base-setup-"));
  const identity = { source: "test", algorithm: "sha256-v1", machineBaseId: "abc", tunnelKey: "machine-base-abc" };
  const first = prepareSetup({ root, identity, now: 1000, pid: 999999 });
  const second = prepareSetup({ root, identity, now: 2000, pid: 999998 });
  assert.equal(first.setupAttemptId, second.setupAttemptId);
  fs.writeFileSync(path.join(root, "setup.lock"), JSON.stringify({ pid: 999999, createdAt: 0 }));
  const third = prepareSetup({ root, identity, now: 20 * 60 * 1000, pid: 999997 });
  assert.equal(third.setupAttemptId, first.setupAttemptId);
  assert.equal(fs.existsSync(path.join(root, "setup.lock")), false);
});
