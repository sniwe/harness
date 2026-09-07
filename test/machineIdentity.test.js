import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { deriveMachineIdentity } from "../src/machineIdentity.js";

test("machine identity is stable and does not expose the source value", () => {
  const exec = (command) => command === "reg.exe" ? "MachineGuid    REG_SZ    ABC-123\n" : "";
  const one = deriveMachineIdentity({ platform: "win32", exec });
  const two = deriveMachineIdentity({ platform: "win32", exec });
  assert.deepEqual(one, two);
  assert.equal(one.source, "machine-guid");
  assert.match(one.tunnelKey, /^machine-base-[a-f0-9]{20}$/);
  assert.equal(one.tunnelKey.includes("abc"), false);
});

test("generic hardware values fall through", () => {
  const exec = (command, args) => command === "reg.exe"
    ? "MachineGuid REG_SZ To be filled by O.E.M."
    : args.at(-1).includes("Win32_ComputerSystemProduct") ? "UUID-1" : "";
  assert.equal(deriveMachineIdentity({ platform: "win32", exec }).source, "system-product-uuid");
});

test("linux uses machine-id rather than hostname when available", (t) => {
  if (!fs.existsSync("/etc/machine-id")) { t.skip("non-Linux host"); return; }
  const identity = deriveMachineIdentity({ platform: "linux" });
  assert.equal(identity.source, "machine-id");
});
