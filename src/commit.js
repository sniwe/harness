import { execFileSync as defaultExecFileSync } from "node:child_process";

const HASH = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function readCheckout({ repoRoot, execFileSync = defaultExecFileSync } = {}) {
  const git = (args) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
  const commit = git(["rev-parse", "HEAD"]).toLowerCase();
  const branch = git(["branch", "--show-current"]);
  const origin = git(["remote", "get-url", "origin"]);
  const dirty = git(["status", "--porcelain"]);
  if (!HASH.test(commit) || !BRANCH.test(branch) || branch.includes("..") || !origin) throw new Error("checkout_identity_invalid");
  return { repoRoot, commit, branch, origin, worktreeClean: !dirty };
}

function fullHash(value) { return HASH.test(String(value || "").trim().toLowerCase()) ? String(value).trim().toLowerCase() : ""; }

export function readRemoteSnapshot({ repoRoot, branch, execFileSync = defaultExecFileSync, observedAt = new Date().toISOString() } = {}) {
  if (!isSafeBranch(branch)) throw new Error("configured_branch_invalid");
  const run = (args) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
  run(["fetch", "--prune", "origin", branch]);
  const fetchedCommit = fullHash(run(["rev-parse", `refs/remotes/origin/${branch}`]));
  const advertisedCommit = fullHash(run(["ls-remote", "origin", `refs/heads/${branch}`]).split(/\s+/)[0]);
  if (!fetchedCommit || !advertisedCommit) throw new Error("origin_tip_invalid");
  if (fetchedCommit !== advertisedCommit) throw Object.assign(new Error("origin_tip_unstable"), { fetchedCommit, advertisedCommit });
  return { branch, commit: advertisedCommit, observedAt };
}

export function captureTrustedLaunch({ checkout, remote, branch }) {
  if (!checkout?.worktreeClean || checkout.branch !== branch || !HASH.test(checkout.commit || "") || !HASH.test(remote?.commit || "") || remote.branch !== branch) throw new Error("local_commit_target_untrusted");
  if (checkout.commit !== remote.commit) throw new Error("local_commit_not_latest");
  return { ...checkout, remoteCommit: remote.commit, remoteObservedAt: remote.observedAt, trust: "stable-origin-tip" };
}

export function captureStartupLaunch({ runId, generation, checkout, remote, branch }) {
  try { return { runId, generation, ...captureTrustedLaunch({ checkout, remote, branch }) }; }
  catch (error) {
    if (error.message !== "local_commit_not_latest") throw error;
    return { runId, generation, ...checkout, remoteCommit: remote.commit, remoteObservedAt: remote.observedAt, trust: "startup-unverified", trustFailure: { error: error.message, launchCommit: checkout.commit, remoteCommit: remote.commit, remoteObservedAt: remote.observedAt } };
  }
}

export function verifyLaunchRevalidation({ checkout, remote, launch, branch }) {
  if (!checkout?.worktreeClean || checkout.branch !== branch || checkout.origin !== launch.origin || checkout.commit !== launch.commit) throw new Error("local_commit_target_untrusted");
  if (remote?.commit !== launch.commit) throw new Error("origin_advanced_during_launch");
  return true;
}

export function verifyTarget({ checkout, expectedCommit, branch }) {
  if (!HASH.test(expectedCommit || "") || expectedCommit !== checkout.commit) throw new Error("commit_target_mismatch");
  if (branch !== checkout.branch) throw new Error("branch_target_mismatch");
  if (!checkout.worktreeClean) throw new Error("worktree_dirty");
  return true;
}

export function isSafeBranch(branch) { return BRANCH.test(branch || "") && !branch.includes(".."); }

export function syncCheckout({ repoRoot, expectedCommit, branch, execFileSync = defaultExecFileSync }) {
  if (!isSafeBranch(branch) || !HASH.test(expectedCommit || "")) throw new Error("sync_target_invalid");
  const run = (args) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
  const before = readCheckout({ repoRoot, execFileSync });
  verifyTarget({ checkout: { ...before, commit: before.commit }, expectedCommit: before.commit, branch: before.branch });
  if (before.branch !== branch) throw new Error("branch_target_mismatch");
  run(["fetch", "--prune", "origin", branch]);
  if (fullHash(run(["rev-parse", `refs/remotes/origin/${branch}`])) !== expectedCommit) throw new Error("origin_advanced_during_sync");
  run(["merge", "--ff-only", `origin/${branch}`]);
  const after = readCheckout({ repoRoot, execFileSync });
  if (after.commit !== expectedCommit) throw new Error("pulled_commit_mismatch");
  return after;
}

export function remoteBranchCommit({ repoRoot, branch, execFileSync = defaultExecFileSync }) {
  return execFileSync("git", ["-C", repoRoot, "ls-remote", "origin", `refs/heads/${branch}`], { encoding: "utf8" }).trim().split(/\s+/)[0]?.toLowerCase() || "";
}
