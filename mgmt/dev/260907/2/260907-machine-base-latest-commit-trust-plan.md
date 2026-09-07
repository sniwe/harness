# Machine-base latest-commit trust hardening

Date: 2026-09-07  
Status: plan only; implementation not authorized by this request  
Target workspace: `C:\\harness`

## Objective

Ensure launch convergence targets only the latest origin commit that the
machine can authoritatively observe for the configured branch. Fail closed if
the checkout is behind origin or if origin advances during launch trust
establishment or immediately before peer coordination.

Do not silently change the target to a newer commit after the immutable launch
record is created. A launch either has a stable trusted target or does not
coordinate.

## Current gap

The server captures local `HEAD` and compares it with a point-in-time
`git ls-remote` result. This rejects an already-stale checkout, but a new push
can land immediately after that comparison. The launch record also does not
show which remote-tip observation established trust.

Absolute prevention of a future push is impossible without locking the remote
repository. The patch therefore defines and enforces a bounded observation
contract: the target equals a stable remote tip observed immediately around
launch capture and again immediately before coordination.

## Trust contract

For the configured exact origin and safe branch:

```text
clean attached checkout
  -> fetch origin branch
  -> read fetched origin/<branch>
  -> read git ls-remote origin refs/heads/<branch>
  -> require both remote values equal
  -> read local HEAD/branch/origin/worktree
  -> require local HEAD === stable remote tip
  -> capture immutable launch target
```

The launch record should include:

```json
{
  "commit": "<local HEAD>",
  "remoteCommit": "<stable origin tip>",
  "remoteObservedAt": "<ISO timestamp>",
  "trust": "stable-origin-tip"
}
```

The existing safety rules remain: exact configured origin, allowlisted branch,
clean worktree, no hard reset, no arbitrary ref, and no automatic overwrite of
local edits.

## Phased patch

### Phase 1 — deterministic remote snapshot

Extend the checkout helper with one allowlisted operation that runs:

```text
git fetch --prune origin <branch>
git rev-parse refs/remotes/origin/<branch>
git ls-remote origin refs/heads/<branch>
```

Validate every result as a full lowercase 40-character commit. Require the
fetched remote-tracking commit and `ls-remote` commit to match. Return the
remote snapshot separately from the local checkout snapshot.

Do not use `git pull`, `reset`, arbitrary refs, or caller-supplied commands in
this trust check.

### Phase 2 — immutable launch capture

At server startup, perform the remote snapshot before peer discovery. Capture
the launch target only when local `HEAD` equals the stable remote tip. If the
checkout is behind, ahead, detached, dirty, or the remote observations differ,
stop with a distinct redacted error such as:

```text
local_commit_not_latest
origin_tip_unstable
local_commit_target_untrusted
```

Never replace the launch commit with the remote value in memory; the local
checkout must already be at the trusted target.

### Phase 3 — pre-coordination revalidation

Immediately before listing peers, repeat the remote-tip observation without
changing the immutable launch target. Require the new remote value to equal
`launch.commit`. If origin advanced, stop peer coordination with
`origin_advanced_during_launch` and expose both redacted commit values in
`/status`.

Do not start partial peer synchronization when this check fails. A subsequent
fresh process launch establishes a new generation and target.

### Phase 4 — peer-side target validation

Keep `commit-sync` exact-target behavior, and additionally require the peer's
configured origin branch to advertise the requested commit immediately before
its fast-forward-only update. Return a visible non-success when the origin has
advanced past the requested target rather than silently propagating an older
commit.

The coordinator must accept only post-relaunch status whose commit equals the
immutable target and whose worker/tunnel confirmation is ready.

### Phase 5 — focused verification

Add deterministic fake-git tests for:

- stable local HEAD equal to fetched and advertised origin tip;
- local checkout behind origin;
- local checkout ahead of origin;
- dirty or detached checkout;
- fetched tip differing from `ls-remote`;
- origin advancing between initial observations;
- origin advancing before coordination;
- peer target no longer being the advertised origin tip;
- no peer sync request after any trust failure;
- immutable launch target not changing during revalidation;
- clear redacted `/status` failure fields.

Run the focused commit suite and the full `npm test` suite.

### Phase 6 — real verification

Use a controlled branch and two machines:

1. Start both machines at the same pushed commit and record stable-tip data.
2. Push a new commit before starting one machine; verify it refuses
   coordination while behind.
3. Update that checkout to the new commit and verify stable launch trust.
4. Push another commit during the launch window; verify the run fails closed
   rather than propagating the earlier target.
5. Start a fresh generation at the newest commit and verify normal convergence.
6. Save sanitized status, commit observations, process generations, and peer
   outcomes under `mgmt\\dev\\260907\\2\\evidence\\`.

## Acceptance criteria

- A checkout behind the current observed origin tip never coordinates peers.
- The target is a full immutable local commit equal to a stable observed origin
  tip.
- Origin-tip disagreement or advancement is visible and fails closed.
- Revalidation never mutates the launch target.
- Peer pulls remain exact, clean, fast-forward-only operations.
- Existing tunnel rotation, relaunch, and no-token behavior are unchanged.
- Tests prove both ordinary stable launches and each trust failure path.
- Real two-machine evidence demonstrates refusal of a stale target and success
  from a fresh latest-commit generation.

## Explicit non-goals

Do not attempt to lock GitHub, claim protection against a push after the final
observation, auto-overwrite dirty/local edits, track a moving branch during a
launch, or introduce a repository hosting API dependency.
