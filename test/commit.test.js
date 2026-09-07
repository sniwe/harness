import test from "node:test";
import assert from "node:assert/strict";
import { readCheckout, verifyTarget } from "../src/commit.js";
import { coordinatePeers, createCommitSyncClient } from "../src/commitSync.js";

test("checkout snapshot is deterministic and target validation is strict", () => {
  const calls = [];
  const execFileSync = (_command, args) => {
    calls.push(args.slice(2));
    const key = args.slice(2).join(" ");
    if (key === "rev-parse HEAD") return "0123456789abcdef0123456789abcdef01234567\n";
    if (key === "branch --show-current") return "main\n";
    if (key === "remote get-url origin") return "https://github.com/sniwe/harness.git\n";
    if (key === "status --porcelain") return "";
    throw new Error(key);
  };
  const checkout = readCheckout({ repoRoot: "C:\\harness", execFileSync });
  assert.equal(checkout.worktreeClean, true);
  assert.equal(verifyTarget({ checkout, expectedCommit: checkout.commit, branch: "main" }), true);
  assert.throws(() => verifyTarget({ checkout, expectedCommit: "bad", branch: "main" }), /commit_target_mismatch/);
  assert.equal(calls.length, 4);
});

test("commit sync client lists registry items without auth", async () => {
  const client = createCommitSyncClient({ registryUrl: "https://registry.test/_functions/tunnels", fetchImpl: async (_url, init) => {
    assert.equal(init.headers.Authorization, undefined);
    return { ok: true, status: 200, json: async () => ({ items: [{ tunnelKey: "machine-base-peer" }] }) };
  } });
  assert.deepEqual(await client.list(), [{ tunnelKey: "machine-base-peer" }]);
});

test("coordination tolerates tunnel outage while peer relaunches", async () => {
  let checks = 0;
  const client = {
    status: async () => {
      checks += 1;
      if (checks === 1) return { result: { commit: { commit: "old" } } };
      if (checks === 2) throw Object.assign(new Error("peer_request_timeout"), { status: 502 });
      return { result: { commit: { commit: "target", branch: "main", confirmed: true }, tunnel: { running: true, publishedUrl: "https://peer.trycloudflare.com" } } };
    },
    sync: async () => ({ status: 202, result: { state: "relaunching" } }),
  };
  const result = await coordinatePeers({ client, peerKeys: ["peer"], localKey: "local", target: { runId: "run", commit: "target", branch: "main" }, waitMs: 5, pollMs: 0, sleep: async () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.peers[0].state, "converged");
});
