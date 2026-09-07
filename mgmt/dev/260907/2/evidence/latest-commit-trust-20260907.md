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

- Pushed commit: `5054b02b2154497454bdd7b59b584844e4365f45`.
- Controlled server process: fake worker, local relay fixture, coordination
  disabled, loopback port 3197.
- `/status` returned `ok: true`, `worktreeClean: true`,
  `trust: stable-origin-tip`, and identical values for `launch.commit`,
  `launch.remoteCommit`, and worker confirmation:
  `5054b02b2154497454bdd7b59b584844e4365f45`.
- `launch.remoteObservedAt` was present and distinct from `capturedAt`.
- The server and relay were stopped; ports 3197, 3411, and 3100 had no
  listening processes after cleanup.

## Scope boundary

The controlled two-machine stale-target refusal and fresh-generation
convergence scenario was not run in this environment. No claim is made for
that physical cross-machine gate.
