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

export function verifyTarget({ checkout, expectedCommit, branch }) {
  if (!HASH.test(expectedCommit || "") || expectedCommit !== checkout.commit) throw new Error("commit_target_mismatch");
  if (branch !== checkout.branch) throw new Error("branch_target_mismatch");
  if (!checkout.worktreeClean) throw new Error("worktree_dirty");
  return true;
}

export function isSafeBranch(branch) { return BRANCH.test(branch || "") && !branch.includes(".."); }

export function syncCheckout({ repoRoot, expectedCommit, branch, execFileSync = defaultExecFileSync }) {
  const run = (args) => execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
  const before = readCheckout({ repoRoot, execFileSync });
  verifyTarget({ checkout: { ...before, commit: before.commit }, expectedCommit: before.commit, branch: before.branch });
  if (before.branch !== branch) throw new Error("branch_target_mismatch");
  run(["fetch", "--prune", "origin", branch]);
  run(["merge", "--ff-only", `origin/${branch}`]);
  const after = readCheckout({ repoRoot, execFileSync });
  if (after.commit !== expectedCommit) throw new Error("pulled_commit_mismatch");
  return after;
}

export function remoteBranchCommit({ repoRoot, branch, execFileSync = defaultExecFileSync }) {
  return execFileSync("git", ["-C", repoRoot, "ls-remote", "origin", `refs/heads/${branch}`], { encoding: "utf8" }).trim().split(/\s+/)[0]?.toLowerCase() || "";
}
