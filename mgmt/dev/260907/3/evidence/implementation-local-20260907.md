# Peer Codex prompt relay implementation evidence

Date: 2026-09-07  
Implementation commit: `f7fad7c`  
Scope: focused and local verification only

## Focused proof

Commands:

```text
node --check src/peerRequest.js
node --check src/server.js
node --check mgmt/machine-base-worker/src/index.js
npm test
git diff --check
```

Observed result: 28 tests passed, 1 platform-specific test skipped on Windows,
and no test failures. The suite covers exact peer lookup, fixed route
selection, authentication, caller allowlisting, strict envelope fields,
request bounds, duplicate/in-flight behavior, worker task dispatch, and
response correlation.

## Local runtime proof

The worker JSONL canary returned:

```json
{"ok":true,"task":"remote-prompt","requestId":"11111111-1111-4111-8111-111111111111","result":"READY"}
```

A native HTTP test completed the local sender -> resolved peer route -> handler
-> worker result round trip and returned `state=completed` with
`result=echo:READY`. No prompt or token was persisted by the test.

## Live public preflight

The Wix tunnels registry returned two `machine-base-*` records. One record's
public `/health` and `/api/machine-base/ping` both succeeded and matched its
exact registered key. Its `/status` showed `startupState=converged`, but its
`/api/machine-base/peer-request` returned HTTP 404, proving that peer is still
running a pre-feature deployment. The second registered machine-base URL was
not DNS-resolvable during the check.

Therefore public prompt execution is not claimed. The remaining manual gate is
to deploy this commit to an approved peer, provision a fresh process-only
`MACHINE_BASE_PEER_TOKEN` and exact caller allowlist on both machines, enable
the feature for a canary window, run the harmless `READY` prompt, then verify
rotation, restart, denial, timeout, and cleanup evidence.

## Peer deployment update

Using the existing exact-key commit-sync route, the reachable peer was updated
to `9dc96cd7d020c6e5bf3679120f1e4e0f901a8e42`. Post-relaunch commit status
confirmed the target commit, clean worktree, worker confirmation, and
generation 4. The tunnel URL rotated and was rediscovered under the same peer
key. The new peer-request route returned `403 peer_route_disabled` without
credentials, proving the deployed default-deny gate. The peer status reported
`tokenConfigured=false` and `allowedCallerCount=0`.

The local machine-base identity key is
`machine-base-73182d23f660c3880e7e`; its currently registered public URL was
not resolvable during this check. Prompt canary execution therefore remains
paused until both process environments are manually provisioned and the local
machine publishes a reachable current tunnel.

## Live relay transport proof

The local machine was started with the feature disabled and published a fresh
tunnel under `machine-base-73182d23f660c3880e7e`. The deployed peer was
rediscovered under its current rotated URL.

- local -> peer `peer-ping`: HTTP 200, exact peer key, `serverRole=machine-base`;
- peer -> local `peer-ping`: HTTP 200, exact local key, `serverRole=machine-base`;
- local `/api/machine-base/peer-request`: HTTP 403 `peer_route_disabled`;
- peer `/api/machine-base/peer-request`: HTTP 403 `peer_route_disabled`.

This proves the existing keyed relay/discovery and public tunnel transport in
both directions. At that point prompt execution was intentionally not yet
tested; the public prompt proof below was performed after deploying the
no-auth implementation.

## Live public prompt proof

The peer was fast-forwarded and relaunched to the no-auth implementation
commit `c50f85c`. A fresh exact-key lookup resolved its current tunnel, and the
local sender completed a real cross-machine request to the peer's Codex worker:

- caller key: `machine-base-73182d23f660c3880e7e`;
- target key: `machine-base-caf45342b1d0acc9b938`;
- result state: `completed`;
- result text: `READY`;
- request ID was preserved end-to-end;
- peer worker turn status was `completed` in approximately 8.5 seconds.

The same request ID returned HTTP 409 on replay. A request with a wrong target
key returned HTTP 400. Post-canary peer status showed `startupState=converged`,
`inFlight=0`, worker confirmation true, and a running published tunnel.

This is public two-machine prompt proof. Timeout, receiver-restart, tunnel
rotation during an active request, and final descendant cleanup remain to be
performed as controlled runtime checks.

## Timeout proof

A harmless prompt that requested a five-second wait was sent with the
server-clamped one-second deadline. The sender returned HTTP 504 Gateway
Timeout. A follow-up peer status check confirmed `startupState=converged`,
`inFlight=0`, and a running tunnel, so the timeout did not leave the peer
request slot wedged.

The next evidence commit is intentionally used as a fast-forward target for
the existing commit-sync relaunch path, providing the receiver restart and
tunnel-rediscovery proof without adding a special restart endpoint.

No credential, prompt token, or raw model output is stored in this artifact.
