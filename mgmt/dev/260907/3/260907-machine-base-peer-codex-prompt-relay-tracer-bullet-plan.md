# Machine-base peer Codex prompt relay

Date: 2026-09-07  
Status: implementation in place; async public prompt polling verified; peer startup coordination still waits on the local launcher refresh
Target workspace: `C:\harness`  
Related slices: `C:\harness\mgmt\dev\260907\0`, `C:\harness\mgmt\dev\260907\1`, `C:\harness\mgmt\dev\260907\2`  
Current peer registry: `https://dev-sitex2082572611.wixdev-sites.org/_functions/tunnels`

## Implementation state

The authorized implementation currently includes the shared bounded peer
request contract in `src/peerRequest.js`, fixed sender/receiver routes in
`src/server.js`, the explicit `remote-prompt` worker task in
`mgmt/machine-base-worker/src/index.js`, README provisioning guidance, and
focused tests in `test/peerRequest.test.js`.

Verified now: syntax checks, 28 passing tests plus one non-Windows skip, a
standalone JSONL worker canary, a local HTTP sender-to-peer-handler round
trip, live Wix peer discovery, two-machine prompt execution, async status
polling, timeout handling, receiver restart with tunnel rotation, and attached
process-tree cleanup.

Live preflight on 2026-09-07 found one healthy registered machine-base peer
running a pre-feature deployment (`/api/machine-base/peer-request` returned
404) and one registered machine-base URL that was not DNS-resolvable. See
`evidence/implementation-local-20260907.md`; this is an external deployment
gate, not proof of local implementation failure.

The healthy peer has since been deployed to the current origin through the
existing commit-sync path, relaunched across generations, and verified under
rotated tunnel URLs. Its new prompt route is enabled by default; either side
can be disabled with the documented feature flags.

The local service is now also publishing a current tunnel. Live peer-ping
proof succeeds in both directions and the public prompt canary has completed
with a real peer Codex worker. The current implementation now uses accepted
jobs plus persistent status polling so long-running turns are observable.

## Objective

Allow an operator or trusted machine-base process on machine A to deliver one
bounded prompt to the Codex CLI worker pair on a selected peer machine B, then
receive a bounded, attributable result:

```text
operator/process A
  -> exact peer tunnelKey lookup through existing Wix tunnels registry
  -> validated current HTTPS quick-tunnel URL
  -> fixed peer-request POST to B
  -> B bounds the request
  -> B's existing Codex worker pool executes the prompt
  -> B returns requestId, peer identity, result, and execution state
  -> A verifies identity, requestId, and completion
```

The feature is a controlled remote prompt capability, not a general remote
shell, arbitrary HTTP proxy, distributed task queue, or replacement for the
existing commit coordinator.

The first production target is one request at a time, one explicitly selected
peer, one bounded prompt, and one bounded response. No fan-out, background
queue, prompt history, or cross-machine conversation continuation is required
for this slice.

## Current implementation facts and reuse boundary

The current `C:\harness` source already provides the important transport
pieces:

- `src/tunnel.js` publishes each machine's rotating quick-tunnel URL under a
  stable machine identity key through the existing Wix relay.
- `src/peerPing.js` performs exact `tunnelKey` lookup, validates one returned
  HTTPS `trycloudflare.com` URL, disables redirects, applies a timeout, and
  validates the peer identity in the response.
- `src/commitSync.js` performs the same registry lookup and bounded POST pattern
  for `/api/machine-base/commit-status` and `/api/machine-base/commit-sync`.
- `src/server.js` already exposes local `/api/machine-base/request` and routes
  its JSON payload to the existing worker pool, but it has no peer request
  route.
- `mgmt/machine-base-worker/src/index.js` already owns the Codex app-server
  session, worker startup/prime, turn serialization, failover, and the local
  payload-to-turn seam.
- The existing Qwen `qwenHandoff` bridge and `HANDOFF_TOKEN` are a separate
  protocol. They must not be reused as a Codex peer credential, and no Qwen
  prompt or token should enter this protocol.

The plan therefore reuses the existing Wix relay as a keyed discovery/control
plane and the existing direct quick-tunnel transport as the data path. It does
not send prompt bodies through Wix. The relay stores/discovers the current peer
URL; machine B receives the prompt directly over its current tunnel.

This deployment intentionally does not add authentication. Exact peer-key
lookup and validated tunnel URLs provide the existing routing boundary;
request bounds, fixed route selection, explicit disable flags, and operator
controlled peer selection contain the prompt operation.

## Non-negotiable safety contract

### Routing and bounded execution

No authentication is required by this deployment. The receiver accepts only
the fixed peer-request route and a strict bounded envelope. The sender accepts
an exact peer key and resolves the current URL through the existing registry;
neither side accepts arbitrary URLs, routes, working directories, environments,
models, or shell commands.

The receiver and sender are enabled by default. Set
`MACHINE_BASE_REMOTE_PROMPTS_ENABLED=0` or
`MACHINE_BASE_PEER_REQUEST_SENDER_ENABLED=0` to disable either side.

### Prompt and response bounds

The peer route accepts a strict envelope, not arbitrary caller-supplied shell
commands or URLs:

```json
{
  "requestId": "<UUID>",
  "targetTunnelKey": "machine-base-<peer-key>",
  "prompt": "<UTF-8 prompt, bounded length>",
  "timeoutMs": 60000
}
```

Required rules:

- `requestId` is a caller-supplied UUID used for correlation and bounded
  duplicate handling; it is never used as a filesystem path.
- `targetTunnelKey` must equal the resolved target key and must not be an
  arbitrary URL.
- `prompt` must be a non-empty UTF-8 string with a conservative maximum size
  such as 32 KiB; reject oversized bodies before parsing unbounded content.
- `timeoutMs` is optional, clamped to a server-owned range, and cannot disable
  the overall timeout.
- caller-supplied `cwd`, environment variables, model, sandbox policy,
  approval policy, executable, headers, or shell command fields are rejected.
- response size, execution duration, and in-flight count are bounded.
- raw upstream bodies and unrestricted model event streams are excluded from
  the response.

The prompt is still capable of asking Codex to perform powerful local work on
machine B. The operator must therefore select the peer and prompt deliberately
and retain the explicit disable flag for rollback.

### Result contract

Return a normalized result with no credential material:

```json
{
  "ok": true,
  "requestId": "<same UUID>",
  "callerKey": "machine-base-<caller-key>",
  "targetKey": "machine-base-<target-key>",
  "state": "completed",
  "workerSlot": "active-or-standby",
  "startedAt": "<ISO timestamp>",
  "completedAt": "<ISO timestamp>",
  "result": "<bounded Codex worker result>"
}
```

Failure results must retain `requestId`, target identity, a normalized error
code, and whether execution started. They must not imply success from HTTP
200 alone. `accepted`, `in_progress`, `timed_out`, `peer_unreachable`,
`peer_denied`, and `worker_failed` remain non-completed states.

## Phased vertical tracer-bullet plan

### Phase 0 - freeze the threat model and deployment decision

Write the protocol decision into the project documentation before code:

```text
machine A -> keyed registry lookup -> validated peer URL -> fixed peer-request
route -> bounded local Codex turn -> correlated response
```

Record these decisions:

- the exact stable peer key selected for the first release;
- the maximum prompt bytes, response bytes, timeout, and concurrent requests;
- whether the endpoint is operator-only, automation-only, or both;
- whether the peer route is enabled persistently or disabled for selected
  machines with the feature flag;
- the configured repo/runtime scope in which the peer worker may operate;
- the retention policy for request IDs and results.

Do not add a new database, message broker, or Wix collection. The existing
machine identity and Wix `tunnels` registry are sufficient for discovery in
this slice.

Verification: review the route bounds against the current public exposure of
`/api/machine-base/request`, the existing peer-control routes, and the separate
Qwen handoff contract. The review must explicitly state that the exact tunnel
key selects routing and is not an authorization mechanism.

#### Manual pause 0 - approve the public route posture

Pause for the operator to choose and record:

1. the exact peer machine key to target;
2. the maximum prompt/response/timeout limits;
3. the initial test-only enablement window;
4. the exact checkout/runtime directory on the peer.

The operator may disable either route with its environment flag before a live
run; no credential provisioning pause is required.

### Phase 1 - extract and harden the shared peer transport seam

Create the smallest shared internal client seam from the already-working
`peerPing.js` and `commitSync.js` behavior:

- exact registry lookup by trimmed, case-sensitive `tunnelKey`;
- exactly one matching registry item;
- validated HTTPS `trycloudflare.com` URL with no credentials, query, hash, or
  redirect use;
- one bounded `fetch` timeout and bounded response parsing;
- normalized peer lookup failures without leaking upstream bodies;
- direct POST to a fixed route suffix after lookup.

Keep existing callers behavior-compatible. `peer-ping` and commit sync should
use the extracted seam without changing their public contracts. Add no generic
caller-selected route to the client; the new prompt client must pass a fixed
`/api/machine-base/peer-request` suffix.

Verification:

- existing peer-ping and commit-sync focused tests stay green;
- tests cover exact key matching, duplicate key, missing key, stale URL,
  invalid scheme/host, redirect rejection, timeout, malformed JSON, and
  non-2xx responses;
- a unit test proves a caller cannot replace the registry URL with a body URL
  or route traversal string;
- `git diff --check` is clean.

### Phase 2 - make local worker request execution explicit and bounded

Retain the existing worker pool and Codex app-server session. Add one explicit
internal task contract for remote prompts rather than making the route depend
on an undocumented arbitrary payload shape:

```json
{
  "task": "remote-prompt",
  "requestId": "<UUID>",
  "prompt": "<bounded string>",
  "timeoutMs": 60000
}
```

At the worker seam:

- serialize requests through the existing pool queue;
- preserve active/standby failover;
- use the server-owned runtime cwd, model, approval policy, and sandbox
  policy;
- pass only the prompt text to the existing Codex turn;
- normalize the worker result into the result contract;
- make timeout and worker restart visible;
- avoid persisting prompt or model output in durable files.

Do not alter the existing `check-project-commit` contract. Do not allow a
remote prompt to invoke `git sync`, change branch, select another checkout, or
override worker policy through request fields.

Verification: fake-worker tests prove accepted, completed, malformed, timeout,
standby-failover, oversized, and duplicate-request behavior. A focused real
local worker test sends a harmless prompt such as `Return exactly the word
READY.` and checks the bounded response. Separate that proof from any public
peer proof.

### Phase 3 - contain the local general worker route

Before exposing a peer route, decide how the existing public
`POST /api/machine-base/request` route is contained. The current route reaches
the local worker pool and is reachable through the published tunnel; leaving
it anonymous would create an unintended unbounded prompt ingress independent of
the new bounded peer route.

Apply the minimum safe boundary:

- keep the existing route disabled by default with its explicit compatibility
  flag;
- or make it loopback-only and reserve the public tunnel for fixed machine-base
  routes;
- or remove the general public route and migrate the local test to a bounded
  local-only route.

Do not silently enable an unbounded public worker endpoint. Keep `/ping`,
commit-status, and commit-sync behavior separate and document their distinct
security contracts.

Verification: the general worker path remains disabled unless explicitly
enabled; fixed liveness and commit-control routes remain correctly routed; no
prompt appears in `/status` or logs.

#### Manual pause 3 - approve compatibility behavior

The operator must choose whether existing callers of
`/api/machine-base/request` may continue during migration. If yes, provide an
expiry date for that compatibility mode. If no, pause until local callers and
the existing live-Wix test are migrated.

### Phase 4 - implement the bounded peer-request route

Add a fixed incoming route on machine B:

```text
POST /api/machine-base/peer-request
```

The handler should execute in this order:

1. reject an oversized body before full accumulation/parsing;
2. require the route to be enabled;
3. parse and validate the strict request envelope;
4. require `targetTunnelKey` to equal B's own stable key;
5. apply the in-flight/concurrency and timeout limits;
6. dispatch the bounded `remote-prompt` task to the existing worker pool;
7. normalize the worker result and return the correlated response;
8. clear transient state without persisting prompt content.

Use explicit status/error mapping:

```text
403 peer_route_disabled
400 request_schema_invalid_or_oversized
409 duplicate_or_in_progress_request
429 peer_worker_capacity_exhausted
504 worker_timeout_or_peer_deadline
502 worker_or_internal_failure
200 completed
```

Do not accept a caller-selected callback URL, arbitrary route, shell command,
environment, working directory, or model. Do not proxy arbitrary headers.

Use a bounded in-memory accepted-job record and a fixed status route for
long-running turns. Return `202 accepted` with the request ID while execution
is pending; return `200` only after the status poll observes `completed`.
Bound the job retention, prompt/result sizes, in-flight count, and maximum
execution window. Never claim completion from `202` or network delivery alone.

Verification: route tests cover disabled route, wrong target key, malformed
envelope, duplicate ID, oversized body,
capacity exhaustion, worker timeout, malformed worker result, and successful
correlated completion. Tests assert no prompt or token is written to logs,
status, relay records, or files.

### Phase 5 - implement the outgoing peer-request operation

Add a local operator/process route or internal operation on machine A with a
fixed peer target:

```text
POST /api/machine-base/peer-request
{
  "tunnelKey": "machine-base-peer",
  "prompt": "Return exactly the word READY.",
  "timeoutMs": 60000
}
```

Keep the outgoing API distinct from the incoming route if the same path would
be ambiguous. A clearer first implementation is:

```text
POST /api/machine-base/peer-request-send
```

The sender should:

1. validate one exact target key and bounded prompt locally;
2. reject the local key;
3. resolve the peer through the existing Wix `tunnels` registry immediately
   before sending;
4. validate the returned URL using the shared peer transport seam;
5. generate a UUID request ID locally;
6. send the fixed peer route over HTTPS with the caller key as optional
   attribution metadata;
7. treat the initial POST as acceptance only, then persistently poll the fixed
   status route until completion or the server-owned deadline;
8. re-resolve the exact peer key before each poll so tunnel rotation is
   tolerated without replaying the initial POST;
9. validate HTTP status, JSON shape, request ID, caller/target identity, and
   terminal state;
10. return normalized evidence with the resolved URL redacted or retained only
   when the operator explicitly requests it;
11. on pre-accept transport failure, report `unknown_execution_state`; after
    acceptance, keep polling through transient lookup/status failures rather
    than replaying the prompt.

The initial POST is never blindly retried. After acceptance, poll the fixed
status route with a tolerant bounded interval and fresh exact-key lookup on
each attempt. Preserve the existing tunnel-rotation behavior: key is stable,
URL is ephemeral.

Verification: fake-peer tests prove exact lookup, fixed route selection,
identity validation, accepted-then-polled completion, tolerant transient
lookup/status failures, timeout, no initial replay, malformed responses, and
unknown execution state. A local two-instance test proves A -> B -> worker ->
correlated response without Wix prompt-body storage.

### Phase 6 - add operational visibility without content leakage

Expose only safe metadata in local `/status` and structured diagnostics:

- route enabled/disabled;
- configured peer-key fingerprints or counts, not raw credentials;
- current in-flight count and capacity;
- request ID, caller key, target key, state, timestamps, and normalized error;
- worker slot and generation;
- registry lookup time and tunnel URL generation, if safe for the deployment.

Never expose prompt text, full Codex output, environment values, model hidden
reasoning, or raw upstream response bodies.

Use request IDs to correlate a live proof. Keep prompt/result capture opt-in
and local-only for a controlled test, with redaction and explicit retention;
the default artifact should contain hashes/lengths and normalized state, not
prompt content.

Verification: log/status snapshot tests scan for token and prompt leakage;
failure tests retain the request ID and terminal/non-terminal distinction;
the route cannot report convergence or completion from HTTP 200 alone.

### Phase 7 - machine-local and public canary gates

Run gates in increasing scope. Stop at the first failed gate and do not proceed
to public exposure:

1. focused unit tests for shared peer transport;
2. focused worker contract tests with a fake Codex app-server;
3. local real Codex worker prompt with a harmless deterministic response;
4. two local machine-base instances with distinct fake identities and a fake
   registry/tunnel;
5. one public tunnel on the receiving machine, with the route disabled first;
6. public canary from A to B using a harmless prompt;
7. tunnel rotation and immediate key-based rediscovery;
8. timeout and receiver shutdown proof;
9. disabled-route and wrong-target-key proof;
10. final cleanup and process-tree scan.

Save evidence under:

```text
C:\harness\mgmt\dev\260907\3\evidence\
```

Separate each artifact into focused tests, local runtime proof, public canary
proof, and unperformed/broken gates. Do not save raw prompt or model output
unless the operator explicitly approves a controlled local artifact.

#### Manual pause 7A - prepare the receiving peer

On machine B, the operator must manually:

- install or verify the same compatible `C:\harness` commit;
- configure B's repo root, branch, origin, and machine identity;
- set the route enable flag for the canary window only;
- start the machine-base launcher and confirm worker prime;
- confirm B's exact `machine-base-*` key and current public tunnel URL through
  the registry.

The operator then pauses and supplies only the non-secret peer key and a
readiness result to the next step. No credential exchange is needed.

#### Manual pause 7B - prepare the sender

On machine A, the operator must manually:

- configure B's exact peer key, not a URL;
- confirm the caller key A will present;
- choose the harmless canary prompt;
- confirm the deadline and that a duplicate/unknown execution state will not
  be retried automatically.

No arbitrary production prompt is sent at this pause. The first canary should
  be an output-only prompt such as `Return exactly the word READY.`

#### Manual pause 7C - approve production enablement

After the canary, pause for explicit approval before enabling general remote
prompts. The approval must name the allowed peer keys, route enablement window,
limits, and rollback owner. If approval is not supplied, leave the route
disabled and retain only the test evidence.

### Phase 8 - failure, rotation, and restart acceptance

Prove the cases that make remote prompt execution materially different from
peer ping or commit sync:

- registry returns no peer, duplicate peer, wrong key, stale URL, or invalid
  scheme;
- tunnel rotates after lookup and before POST;
- receiver denies route enablement or target-key mismatch;
- request is accepted and the network fails before the response;
- worker times out, fails over, or exits;
- receiver restarts while a request is in flight;
- duplicate `requestId` arrives before and after completion;
- two callers contend for the single in-flight slot;
- sender and receiver disagree on protocol version or result schema;
- process/log/status inspection proves no orphan worker or tunnel process;
- a prompt attempts to override cwd, model, approval, sandbox, secret access,
  or Git policy and is rejected at the envelope boundary or remains governed
  by server-owned worker policy.

For every failure, record whether execution may have started. The sender must
not turn an unknown execution state into a safe-to-retry state without a
durable status lookup or explicit operator decision.

Verification: focused tests cover all listed cases; a two-machine controlled
run covers public URL rotation, receiver restart, bounded failure, and cleanup.

### Phase 9 - rollout and rollback

Roll out in this order:

1. ship route code with remote prompts optionally disabled for the initial rollout;
2. verify local worker and peer transport tests on both machines;
3. set the route feature flags manually for the canary window;
4. enable on B only for a short canary window;
5. run one harmless prompt from A;
6. inspect request ID, identity, timing, and no-leak evidence;
7. enable additional peer keys one at a time;
8. keep the existing commit-sync and Qwen handoff paths unchanged;
9. disable the feature flag to roll back prompt execution;
10. disable the route if unexpected prompt execution is observed.

Rollback is the route-disable flag plus process restart/relaunch. It must not
require deleting relay records, changing the Qwen tunnel, resetting a checkout,
or removing unrelated worker functionality. If the new client is incompatible,
the existing peer-ping and commit-sync clients must continue to operate.

## Acceptance gates

- The plan's implementation uses existing Wix keyed tunnel registration and
  exact-key peer discovery rather than a new peer-address database.
- Prompt bodies travel directly to the validated current peer tunnel, not
  through Wix storage or the Qwen handoff relay.
- The receiver and sender can be disabled with explicit feature flags.
- The existing worker pool, Codex app-server session, queue, prime, timeout,
  and failover seams are reused rather than a second Codex runtime being
  invented.
- The local anonymous public worker ingress is contained before peer prompt
  execution is enabled.
- The peer client accepts a key, never an arbitrary URL or route.
- The fixed incoming route accepts a strict bounded envelope and rejects
  caller-controlled cwd, environment, model, sandbox, approval, and shell
  fields.
- Request IDs, caller/target keys, and execution state are validated end to
  end; HTTP 200, 202, or network delivery alone never means completion.
- Pre-send transport failures may re-resolve once; post-acceptance failures
  are observed by persistent status polling and are not blindly retried.
- Long-running prompts return `202 accepted` first and are completed only after
  a correlated status poll; polling tolerates transient tunnel/registry
  failures within the bounded execution window.
- Focused tests, local worker proof, public canary proof, and unperformed
  broad/runtime proof are reported separately.
- Public canary evidence contains no prompt or raw model output unless approved.
- Tunnel rotation, peer restart, disabled-route behavior, worker timeout, and
  process cleanup remain visible and bounded.
- Disabling the feature restores a state in which no remote prompt can execute;
  existing Qwen handoff and commit coordination remain independently usable.

## Explicit non-goals

Do not add:

- arbitrary remote shell or PowerShell execution;
- arbitrary HTTP proxying or caller-selected peer URLs/routes;
- unbounded public Codex worker access;
- routing prompt bodies through Qwen ASR or `qwenHandoff`;
- prompt bodies in Wix collections, Git, Markdown, logs, or memory;
- a durable distributed prompt queue or conversation history;
- automatic fan-out to every registered peer;
- automatic retry after a prompt may have started;
- remote checkout changes, Git operations, force resets, or arbitrary origins;
- caller-controlled model, cwd, environment, sandbox, approval, or executable;
- production enablement without the manual canary pause above.
