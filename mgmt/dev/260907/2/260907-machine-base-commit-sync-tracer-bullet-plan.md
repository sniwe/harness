# Machine-base launch commit agreement and peer auto-relaunch

Date: 2026-09-07  
Status: plan only; no implementation authorized by this request  
Target workspace: `C:\\harness`  
Prior peer-ping implementation: `C:\\harness\\mgmt\\dev\\260907\\1`

## Objective

On every machine-base launch, establish the exact commit running in that
launch, wait until the Codex worker pair has completed startup and priming, then
coordinate that commit with the other registered machine-base peers:

```text
launcher -> server -> worker initialize/prime -> local commit confirmation
  -> exact Wix peer discovery -> peer Codex commit confirmation
  -> pull/relaunch when mismatched -> tunnel-ready confirmation
```

The coordinator must never report success from an accepted update request,
HTTP 200, a live PID, or a tunnel URL alone. Success requires post-relaunch
commit confirmation and a ready published tunnel.

## Current seams and gaps

The current server already has startup that waits for the active/standby worker
pool, the worker's literal startup probe, the rotating tunnel supervisor, Wix
exact-key discovery, and peer ping routes. It has no launch supervisor, commit
contract, worker-specific commit task, peer update route, or durable
relaunch handoff.

Do not overload the public general worker route for this control flow. Do not
let Codex decide whether a git update is safe or execute an arbitrary shell
command.

## Commit contract

At server launch, deterministically capture and persist an immutable launch
record before peer coordination:

```json
{
  "runId": "...",
  "generation": 3,
  "repoRoot": "C:\\harness",
  "branch": "main",
  "commit": "<40 lowercase hex characters>",
  "origin": "<validated configured origin>",
  "worktreeClean": true,
  "capturedAt": "<ISO timestamp>"
}
```

Use allowlisted deterministic git commands (`rev-parse HEAD`, branch, and
`status --porcelain`); never ask Codex to invent the hash. Capture the value
before any peer update and keep it immutable for that launch generation.

The local Codex worker must also be asked to inspect the project and return a
strict, bounded object:

```json
{
  "task": "check-project-commit",
  "commit": "<hash>",
  "branch": "main",
  "confirmed": true
}
```

Accept the worker result only when its schema is valid and its commit exactly
equals the deterministic launch record. Natural language, short hashes,
unverified command claims, or a different branch are denial/error outcomes.

The target is the local launch commit, not an unverified remote tip. Before
coordination, verify the configured origin and branch still advertise that
commit. If not, stop with `local_commit_target_untrusted`; never propagate
stale or ambiguous code automatically.

## Peer control protocol

Keep the existing liveness route public and side-effect free. Add separate,
bounded peer-control routes; this deployment intentionally does not add token
authentication. Their safety boundary is exact peer-key discovery, validated
quick-tunnel URLs, clean-worktree checks, and allowlisted fast-forward git
operations:

```text
POST /api/machine-base/commit-status
{}

POST /api/machine-base/commit-sync
{"runId":"...","expectedCommit":"<40 lowercase hex>","branch":"main"}
```

`commit-status` asks the peer's Codex worker to run the allowlisted
`check-project-commit` task, then returns deterministic checkout data plus the
validated confirm/deny result. It must not start a pull.

`commit-sync` is idempotent and bounded:

1. Validate run ID, exact commit, and configured branch.
2. Reject another repository, branch, origin, dirty worktree, detached branch,
   local edits, or an update already targeting a different commit.
3. Return `already_current` when the exact commit is already running.
4. Run `git fetch --prune origin <branch>` and `git merge --ff-only
   origin/<branch>` in the allowlisted repository.
5. Verify `HEAD === expectedCommit` and run Codex commit confirmation.
6. Persist a relaunch handoff containing only the validated target and run ID.
7. Drain HTTP requests, stop workers/cloudflared, and exit with a dedicated
   relaunch code understood by the launcher.

Never use `git reset --hard`, force-push, arbitrary refs, caller-supplied
commands, or an arbitrary pull URL. The pull is deterministic server code;
Codex confirms the result but does not control update safety.

## Phased vertical tracer-bullet plan

### Phase 0 — startup and trust contracts

Record repository root, branch, origin allowlist, peer registry URL, peer
  peer-control route configuration, relaunch exit code, timeouts, and whether
coordination is enabled. Define these states:

```text
starting -> workers_ready -> local_commit_confirmed -> peers_checking
  -> syncing -> relaunching -> tunnel_ready -> converged
```

Persist state atomically under `data/machine-base`, with redacted errors and no
secret material. Refuse synchronization when the repository root is outside
the configured checkout or the worktree is dirty.

Verification: tests cover hash/branch validation, origin allowlisting,
dirty-worktree rejection, transitions, stale handoff rejection, and redaction.

### Phase 1 — Codex commit confirmation after prime

Extend the worker contract with one allowlisted `check-project-commit` task.
Ask the Codex CLI worker to inspect the current checkout and emit only the
agreed JSON object. Validate that result against the deterministic git snapshot.

Do not enter coordination until both worker slots complete their existing
initialize/prime sequence and the active worker completes commit confirmation.
Preserve active/standby failover; retries use the same run ID and immutable
launch commit.

Verification: fake app-server tests prove prime-before-confirmation, malformed
output rejection, hash mismatch denial, standby retry, and no coordination
while required worker state is unready. A real Codex launch proves the object.

### Phase 2 — peer commit status

Implement `POST /api/machine-base/commit-status` and its client. Discover peers
from Wix using exact `tunnelKey` matching, exclude the local key, validate the
current HTTPS quick-tunnel URL, and ask each peer for status with one bounded
timeout.

Normalize each result to `match`, `mismatch`, `unreachable`, or `invalid`. A
worker denial is not a match even when the deterministic hash matches. Keep the
check sequential or bounded; add no scheduler or cache.

Verification: fake-peer tests cover public route access, match/deny, malformed
status, timeout, stale URL, duplicate key, and visible partial failure.

### Phase 3 — peer pull and relaunch endpoint

Implement `commit-sync` and an external launcher. Make the
production entrypoint the launcher, which owns the server child and restarts it
only for the dedicated relaunch exit code with bounded backoff. Preserve run ID,
increment generation, and write startup/exit diagnostics.

The update path holds a per-machine lock, allows one sync, uses
fast-forward-only git operations, verifies the exact resulting commit, runs
Codex confirmation, then gracefully drains and exits. Identical requests return
`in_progress`; a different target is rejected. Pull or verification failure is
visible and never reported as success.

Verification: fake-git and fake-worker tests cover already-current,
fast-forward, dirty checkout, wrong branch, non-fast-forward, interrupted
pull, duplicate request, drain timeout, relaunch exit code, backoff, and no
force-reset behavior. A child-process test proves a new generation starts.

### Phase 4 — coordinator convergence workflow

After local worker prime and local commit confirmation:

1. Capture the immutable launch target and verify it remains trusted.
2. List exact peer records and obtain peer status.
3. Mark matching peers confirmed.
4. Send one `commit-sync` request to each mismatched peer.
5. Treat accepted/in-progress as non-success.
6. Poll the same key after tunnel rotation until its new URL responds.
7. Require post-relaunch health, commit status, worker confirmation, and a
   running tunnel with a non-empty published URL.
8. Bound the total convergence deadline and report every unresolved peer.

On tunnel rotation, rediscover by key rather than reuse the old URL. Continue
checking other peers after one failure, but return a non-converged result. Do
not retry a non-idempotent update more than once per run ID.

Expose `/status` fields for launch commit, worker confirmation, coordination run,
per-peer state, relaunch generation, observed/published tunnel URL, and last
failure. Redact tokens, git credentials, prompts, and model output.

Verification: a fake two-peer composition proves local confirmation, one match,
one mismatch, peer pull, process relaunch, URL rotation, post-relaunch proof,
bounded failure, and aggregate status.

### Phase 5 — real two-machine acceptance

Use two distinct machine-base keys and a controlled branch/checkout:

1. Start both machines through the new launcher.
2. Confirm both worker pairs prime and confirm their launch commits.
3. Confirm Wix returns both current tunnel URLs.
4. Confirm a same-commit run reports convergence without pulling.
5. Create and push one fast-forward commit on the configured origin.
6. Launch coordination on the machine running the previous commit.
7. Verify the peer denies the old commit.
8. Verify sync performs fast-forward pull and relaunch.
9. Verify the new generation confirms the target through Codex.
10. Verify the tunnel publishes and success is reported only then.
11. Stop a peer during convergence and verify visible non-convergence.
12. Prove no orphaned worker, Codex, cloudflared, or launcher descendants.

Save command output, sanitized status responses, commit hashes, generations,
tunnel transitions, and cleanup evidence under
`C:\harness\mgmt\dev\260907\2\evidence\`. Separate focused tests, local
runtime proof, and public two-machine proof.

## Acceptance gates

- Launch target commit is deterministic and immutable for its generation.
- Codex initializes and primes before local confirmation or peer coordination.
- Local and peer Codex workers explicitly confirm or deny the checkout commit.
- Discovery uses exact Wix `tunnelKey` semantics and current URLs.
- Status and sync routes do not execute arbitrary tasks or commands; token
  authentication is intentionally out of scope for this deployment.
- Pull is allowlisted, fast-forward-only, clean-worktree-only, and exact-target
  verified; no hard reset or arbitrary ref is accepted.
- A mismatched peer automatically relaunches through a real supervisor with
  durable run/generation state and bounded retry behavior.
- Success is reported only after post-relaunch commit confirmation and tunnel
  readiness for every required peer.
- Rotation, stale URLs, worker denial, pull failure, timeout, and peer loss stay
  visible as non-success outcomes.
- Shutdown leaves no orphaned descendants and no secret appears in logs/status.

## Explicit non-goals

Do not add arbitrary remote shell execution, Codex-controlled git operations,
force resets, cross-repository updates, automatic dirty-worktree overwrites,
peer fan-out beyond the configured registry, periodic background
synchronization, or distributed consensus/election. Handle those in a separate
security and operations specification.
