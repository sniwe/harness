import test from "node:test";
import assert from "node:assert/strict";
import { captureTrustedLaunch, readCheckout, readRemoteSnapshot, syncCheckout, verifyLaunchRevalidation, verifyTarget } from "../src/commit.js";
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

function fakeGit({ localCommit, remoteCommit, advertisedCommit = remoteCommit, branch = "main", dirty = "", origin = "https://github.com/sniwe/harness.git" }) {
  const calls = [];
  const execFileSync = (_command, args) => {
    const gitArgs = args.slice(2);
    calls.push(gitArgs);
    switch (gitArgs.join(" ")) {
      case "fetch --prune origin main": return "";
      case "rev-parse refs/remotes/origin/main": return `${remoteCommit}\n`;
      case "ls-remote origin refs/heads/main": return `${advertisedCommit}\trefs/heads/main\n`;
      case "rev-parse HEAD": return `${localCommit}\n`;
      case "branch --show-current": return `${branch}\n`;
      case "remote get-url origin": return `${origin}\n`;
      case "status --porcelain": return dirty;
      default: throw new Error(gitArgs.join(" "));
    }
  };
  return { calls, execFileSync };
}

const A = "0123456789abcdef0123456789abcdef01234567";
const B = "fedcba9876543210fedcba9876543210fedcba98";

test("remote snapshot requires fetched and advertised origin tips to agree", () => {
  const stable = fakeGit({ localCommit: A, remoteCommit: A });
  const remote = readRemoteSnapshot({ repoRoot: "C:\\harness", branch: "main", execFileSync: stable.execFileSync, observedAt: "2026-09-07T00:00:00.000Z" });
  assert.deepEqual(remote, { branch: "main", commit: A, observedAt: "2026-09-07T00:00:00.000Z" });
  assert.deepEqual(stable.calls.slice(0, 3).map((args) => args.join(" ")), ["fetch --prune origin main", "rev-parse refs/remotes/origin/main", "ls-remote origin refs/heads/main"]);
  const unstable = fakeGit({ localCommit: A, remoteCommit: A, advertisedCommit: B });
  assert.throws(() => readRemoteSnapshot({ repoRoot: "C:\\harness", branch: "main", execFileSync: unstable.execFileSync }), (error) => error.message === "origin_tip_unstable" && error.fetchedCommit === A && error.advertisedCommit === B);
});

test("trusted launch rejects stale, ahead, dirty, detached, and captures immutable remote trust", () => {
  const remote = { branch: "main", commit: A, observedAt: "2026-09-07T00:00:00.000Z" };
  const checkout = { repoRoot: "C:\\harness", commit: A, branch: "main", origin: "origin", worktreeClean: true };
  assert.deepEqual(captureTrustedLaunch({ checkout, remote, branch: "main" }).trust, "stable-origin-tip");
  for (const candidate of [
    { ...checkout, commit: B },
    { ...checkout, worktreeClean: false },
    { ...checkout, branch: "" },
  ]) assert.throws(() => captureTrustedLaunch({ checkout: candidate, remote, branch: "main" }), /local_commit_(?:not_latest|target_untrusted)/);
  const launch = captureTrustedLaunch({ checkout, remote, branch: "main" });
  const newer = { ...remote, commit: B, observedAt: "2026-09-07T00:01:00.000Z" };
  assert.equal(launch.commit, A);
  assert.equal(newer.commit, B);
  assert.equal(launch.commit, A);
});

test("origin advancement before coordination fails without changing immutable target", () => {
  const launch = { ...captureTrustedLaunch({ checkout: { repoRoot: "C:\\harness", commit: A, branch: "main", origin: "origin", worktreeClean: true }, remote: { branch: "main", commit: A, observedAt: "t0" }, branch: "main" }) };
  assert.throws(() => verifyLaunchRevalidation({ checkout: launch, remote: { branch: "main", commit: B, observedAt: "t1" }, launch, branch: "main" }), /origin_advanced_during_launch/);
  assert.equal(launch.commit, A);
});

test("peer sync refuses a newer fetched tip before fast-forward merge", () => {
  const calls = [];
  const execFileSync = (_command, args) => {
    const gitArgs = args.slice(2);
    calls.push(gitArgs.join(" "));
    switch (gitArgs.join(" ")) {
      case "rev-parse HEAD": return `${A}\n`;
      case "branch --show-current": return "main\n";
      case "remote get-url origin": return "origin\n";
      case "status --porcelain": return "";
      case "fetch --prune origin main": return "";
      case "rev-parse refs/remotes/origin/main": return `${B}\n`;
      default: throw new Error(gitArgs.join(" "));
    }
  };
  assert.throws(() => syncCheckout({ repoRoot: "C:\\harness", expectedCommit: A, branch: "main", execFileSync }), /origin_advanced_during_sync/);
  assert.equal(calls.includes("merge --ff-only origin/main"), false);
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
