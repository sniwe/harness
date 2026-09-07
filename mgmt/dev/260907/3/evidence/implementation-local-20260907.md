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

No credential, prompt token, or raw model output is stored in this artifact.
