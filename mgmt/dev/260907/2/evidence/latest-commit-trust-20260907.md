# Latest-commit trust verification

Date: 2026-09-07

## Focused proof

- `npm test`: 23 passed, 1 platform-skipped, 0 failed.
- Fake-git coverage proves stable fetched/advertised tips, stale and ahead
  checkouts, dirty and detached checkouts, unstable origin observations,
  immutable launch targets, pre-coordination origin advancement, and refusal
  to merge after a newer fetched peer tip.
- `git diff --check`: passed.

## Live local proof

- Latest pushed implementation commit: `35256a3`.
- The recorded live launch ran at implementation commit
  `5054b02b2154497454bdd7b59b584844e4365f45`; subsequent changes only
  tightened origin evidence and no-op peer-sync validation.
- Controlled server process: fake worker, local relay fixture, coordination
  disabled, loopback port 3197.
- `/status` returned `ok: true`, `worktreeClean: true`,
  `trust: stable-origin-tip`, and identical values for `launch.commit`,
  `launch.remoteCommit`, and worker confirmation:
  `5054b02b2154497454bdd7b59b584844e4365f45`.
- `launch.remoteObservedAt` was present and distinct from `capturedAt`.
- The server and relay were stopped; ports 3197, 3411, and 3100 had no
  listening processes after cleanup.

## Controlled two-checkout proof

- A local bare origin and two clean checkouts were used as machine A and
  machine B; no GitHub history was changed by this scenario.
- With machine A at `1c002c3` and origin at `b18ee90`, the real server exited
  with `local_commit_not_latest` before opening a service port.
- After machine A fast-forwarded to `b18ee90`, real `/status` reported
  `worktreeClean: true`, `trust: stable-origin-tip`, and matching launch,
  remote, and worker commits.
- A later origin push to `9cb6a5e` occurred after the server had already
  completed coordination, so it did not prove the launch-window race. It is
  recorded as an unsuccessful timing attempt, not as a pass.

## Controlled launch-window race and fresh generation

- A scheduled push advanced the local origin from
  `fadddba8f6ea16b6dc9d7a2546c7bd69504eb9d6` to
  `66062671e9f5b903325e7981a9432cf2d9d25026` during server startup.
- The real server returned `/status` with `startupState: coordination_failed`,
  `skipped: origin_advanced_during_launch`, and preserved the original
  `launch.commit` while exposing the newer `trustFailure.remoteCommit`.
- Machine A then fast-forwarded to `66062671e9f5b903325e7981a9432cf2d9d25026`.
  A fresh server generation returned `startupState: converged`,
  `coordination.ok: true`, and matching launch/remote commits.
- This is controlled two-checkout local-process evidence; it is not physical
  two-machine evidence.

## Scope boundary

The physical two-machine stale-target refusal and fresh-generation
convergence scenario was not run in this environment. The controlled
two-checkout proof above is local-process evidence, not physical
cross-machine evidence.
