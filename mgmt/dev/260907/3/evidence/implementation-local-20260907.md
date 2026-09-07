# Peer Codex prompt relay implementation evidence

Date: 2026-09-07  
Implementation base commit: `c50f85c`; final cleanup is included in the current commit
Scope: focused, local, and public peer verification

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
selection, strict envelope fields,
request bounds, duplicate/in-flight behavior, worker task dispatch, and
response correlation.

## Local runtime proof

The worker JSONL canary returned:

```json
{"ok":true,"task":"remote-prompt","requestId":"11111111-1111-4111-8111-111111111111","result":"READY"}
```

A native HTTP test completed the local sender -> resolved peer route -> handler
-> worker result round trip and returned `state=completed` with
`result=echo:READY`. No prompt was persisted by the test.

## Live public preflight

The Wix tunnels registry returned two `machine-base-*` records. One record's
public `/health` and `/api/machine-base/ping` both succeeded and matched its
exact registered key. Its `/status` showed `startupState=converged`, but its
`/api/machine-base/peer-request` returned HTTP 404, proving that peer is still
running a pre-feature deployment. The second registered machine-base URL was
not DNS-resolvable during the check.

Therefore public prompt execution was not claimed at this preflight stage. The
remaining gate was to deploy the feature to an approved peer, enable it for a
canary window, run the harmless `READY` prompt, then verify rotation, restart,
timeout, and cleanup evidence.

## Peer deployment update

Using the existing exact-key commit-sync route, the reachable peer was updated
to `9dc96cd7d020c6e5bf3679120f1e4e0f901a8e42`. Post-relaunch commit status
confirmed the target commit, clean worktree, worker confirmation, and
generation 4. The tunnel URL rotated and was rediscovered under the same peer
key. The new peer-request route returned `403 peer_route_disabled` without
feature flag, proving the deployed disable gate. No credential was involved.

The local machine-base identity key is
`machine-base-73182d23f660c3880e7e`; its currently registered public URL was
not resolvable during this check. Prompt canary execution at that earlier
point remained paused until the peer route was enabled and the local machine
published a reachable current tunnel.

## Live relay transport proof

The local machine was started with the feature disabled and published a fresh
tunnel under `machine-base-73182d23f660c3880e7e`. The deployed peer was
rediscovered under its current rotated URL.

- local -> peer `peer-ping`: HTTP 200, exact peer key, `serverRole=machine-base`;
- peer -> local `peer-ping`: HTTP 200, exact local key, `serverRole=machine-base`;
- local `/api/machine-base/peer-request`: HTTP 403 `peer_route_disabled`;
- peer `/api/machine-base/peer-request`: HTTP 403 `peer_route_disabled`.

This proves the existing keyed relay/discovery and public tunnel transport in
both directions. Prompt execution was tested after deploying the no-auth
implementation below.

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

This is public two-machine prompt proof. Receiver restart and tunnel rotation
were exercised during commit-sync deployment.

## Timeout proof

A harmless prompt that requested a five-second wait was sent with the
server-clamped one-second deadline. The sender returned HTTP 504 Gateway
Timeout. A follow-up peer status check confirmed `startupState=converged`,
`inFlight=0`, and a running tunnel, so the timeout did not leave the peer
request slot wedged.

Receiver restart and tunnel rediscovery were exercised during the commit-sync
deployment and URL rotation; the running peer then reconverged with
`inFlight=0`. No credential or raw model output is stored in this artifact.
