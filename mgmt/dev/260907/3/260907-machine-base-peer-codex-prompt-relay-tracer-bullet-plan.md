# Machine-base peer Codex prompt relay

Date: 2026-09-07  
Status: implementation in progress; focused/local gates verified, public two-machine gate pending manual peer provisioning  
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
standalone JSONL worker canary, and a local HTTP sender-to-peer-handler round
trip. Not yet verified: two distinct machines, live Wix peer discovery plus
public tunnel delivery, approved process-only token provisioning, public
tunnel rotation, receiver restart, and the final no-orphan process scan.

## Objective

Allow an operator or trusted machine-base process on machine A to deliver one
bounded prompt to the Codex CLI worker pair on a selected peer machine B, then
receive a bounded, attributable result:

```text
operator/process A
  -> exact peer tunnelKey lookup through existing Wix tunnels registry
  -> validated current HTTPS quick-tunnel URL
  -> authenticated peer-request POST to B
  -> B authorizes and bounds the request
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

The current commit-control routes are not sufficient authorization for prompt
execution. Exact peer identity proves routing, not permission. A separate
process-only machine-base peer credential and explicit peer allowlist are
required before the route can execute a Codex turn.

## Non-negotiable safety contract

### Authentication and authorization

Use two independent checks on machine B:

1. `Authorization: Bearer <MACHINE_BASE_PEER_TOKEN>` must match a token
   provisioned into B's process environment or protected runtime secret store.
2. The claimed caller machine key must be in B's explicit configured peer
   allowlist, and the resolved request must be addressed to B's exact current
   tunnel key.

The token is process-only. Never write it to source, Git, Markdown, test
artifacts, relay records, URLs, command output, logs, or memory. Do not reuse
`HANDOFF_TOKEN`, the Qwen bridge token, or a token intended for ASR traffic.

The request must carry the caller's stable machine-base key in a header such as
`X-Machine-Base-Caller-Key`; B must compare it byte-for-byte with an allowed
key. The header is an authorization input only after the bearer token passes;
it is not a substitute for the token.

Default behavior is deny:

- remote prompt route disabled unless
  `MACHINE_BASE_REMOTE_PROMPTS_ENABLED=1`;
- no allowed caller keys unless explicitly configured;
- no default token;
- no anonymous fallback;
- no use of the public Qwen relay as a bypass.

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
- secrets, authorization headers, raw upstream bodies, and unrestricted model
  event streams are excluded from the response.

The prompt is still capable of asking Codex to perform powerful local work on
machine B. Therefore the route must be treated as remote code execution by
the operator, even though the route itself does not accept a raw shell
command. Production enablement requires a human approval pause on B.

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
machine A -> keyed registry lookup -> validated peer URL -> authenticated
peer-request route -> bounded local Codex turn -> correlated response
```

Record these decisions:

- whether the first release permits prompts from one manually named peer or
  from a small configured allowlist;
- the maximum prompt bytes, response bytes, timeout, and concurrent requests;
- whether the endpoint is operator-only, automation-only, or both;
- the exact process-only token provisioning mechanism on both machines;
- whether the peer route is enabled only during a test window or persistently;
- the configured repo/runtime scope in which the peer worker may operate;
- the retention policy for request IDs and results.

Do not add a new database, message broker, or Wix collection. The existing
machine identity and Wix `tunnels` registry are sufficient for discovery in
this slice.

Verification: review the threat model against the current public exposure of
`/api/machine-base/request`, the unauthenticated commit-control routes, and the
separate Qwen handoff contract. The review must explicitly state that a
stable tunnel key is routing identity, not authorization.

#### Manual pause 0 - approve the security posture

Pause for the operator to choose and record:

1. the exact peer machine keys allowed to send prompts;
2. the maximum prompt/response/timeout limits;
3. the secret provisioning method;
4. the initial test-only enablement window;
5. the exact checkout/runtime directory on the peer.

No implementation proceeds to a live route until this approval is supplied.

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

### Phase 3 - protect the local public worker route

Before exposing a peer route, decide how the existing public
`POST /api/machine-base/request` route is contained. The current route reaches
the local worker pool and is reachable through the published tunnel; leaving
it anonymous would create an unintended prompt ingress independent of the new
peer authorization.

Apply the minimum safe boundary:

- either make the existing route loopback-only and reserve the public tunnel
  for fixed machine-base routes;
- or require the same machine-base authorization and strict envelope on the
  route, with an explicit compatibility flag only for the existing live test;
- or remove the general public route and migrate the local test to a bounded
  local-only route.

Do not silently preserve an anonymous public worker endpoint. Keep `/ping`,
commit-status, and commit-sync behavior separate and document their distinct
security contracts.

Verification: public unauthenticated requests to the general worker path are
denied; loopback/local tests still prove the worker route intended for local
use; fixed liveness and commit-control routes remain correctly routed; no
prompt or credential appears in `/status` or logs.

#### Manual pause 3 - approve compatibility behavior

The operator must choose whether existing callers of
`/api/machine-base/request` may continue during migration. If yes, provide an
expiry date and authorization value for that compatibility mode. If no, pause
until local callers and the existing live-Wix test are migrated.

### Phase 4 - implement the authenticated peer-request route

Add a fixed incoming route on machine B:

```text
POST /api/machine-base/peer-request
```

The handler should execute in this order:

1. reject an oversized body before full accumulation/parsing;
2. require the route to be enabled;
3. validate the bearer token without logging it;
4. validate the caller-key header against the configured exact allowlist;
5. parse and validate the strict request envelope;
6. require `targetTunnelKey` to equal B's own stable key;
7. apply the in-flight/concurrency and timeout limits;
8. dispatch the allowlisted `remote-prompt` task to the existing worker pool;
9. normalize the worker result and return the correlated response;
10. clear transient state without persisting prompt content or credentials.

Use explicit status/error mapping:

```text
401 peer_auth_required_or_invalid
403 peer_caller_not_allowed_or_route_disabled
400 request_schema_invalid_or_oversized
409 duplicate_or_in_progress_request
429 peer_worker_capacity_exhausted
504 worker_timeout_or_peer_deadline
502 worker_or_internal_failure
200 completed
```

Do not accept a caller-selected callback URL, arbitrary route, shell command,
environment, working directory, or model. Do not proxy arbitrary headers.

For the first slice, a bounded synchronous response is preferable to inventing
a durable cross-machine queue. If the worker may exceed the HTTP deadline,
return `202 accepted` only with a separately designed status/poll contract;
never return `202` and claim the prompt completed. The preferred first gate is
to reject prompts that cannot fit within the bounded synchronous deadline.

Verification: route tests cover disabled route, missing/wrong token, disallowed
caller, wrong target key, malformed envelope, duplicate ID, oversized body,
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
6. send the fixed peer route over HTTPS with the bearer token and caller-key
   header;
7. apply one overall deadline and no blind retry for an executing prompt;
8. validate HTTP status, JSON shape, request ID, caller/target identity, and
   terminal state;
9. return normalized evidence with the resolved URL redacted or retained only
   when the operator explicitly requests it;
10. on transport failure, report `unknown_execution_state` rather than
    replaying a potentially completed prompt.

Re-resolve the peer URL only for a clearly pre-send transport failure. Do not
retry after the peer may have accepted the request unless the protocol has a
durable idempotency/status proof. Preserve the existing tunnel-rotation
behavior: key is stable, URL is ephemeral.

Verification: fake-peer tests prove exact lookup, auth header construction
without exposing the token, fixed route selection, identity validation,
timeout, pre-send re-resolution, post-send no-retry, malformed responses, and
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

Never expose prompt text, full Codex output, bearer token, environment values,
authorization headers, model hidden reasoning, or raw upstream response bodies.

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
6. authenticated public canary from A to B using a harmless prompt;
7. tunnel rotation and immediate key-based rediscovery;
8. timeout and receiver shutdown proof;
9. unauthorized caller/token proof;
10. final cleanup and process-tree scan.

Save evidence under:

```text
C:\harness\mgmt\dev\260907\3\evidence\
```

Separate each artifact into focused tests, local runtime proof, public canary
proof, and unperformed/broken gates. Redact tokens and do not save raw prompt
or model output unless the operator explicitly approves a controlled local
artifact.

#### Manual pause 7A - provision the receiving peer

On machine B, the operator must manually:

- install or verify the same compatible `C:\harness` commit;
- configure B's repo root, branch, origin, and machine identity;
- create a fresh machine-base peer token outside the repository;
- configure B's allowed caller key(s);
- set the route enable flag for the canary window only;
- start the machine-base launcher and confirm worker prime;
- confirm B's exact `machine-base-*` key and current public tunnel URL through
  the registry.

The operator then pauses and supplies only the non-secret peer key and a
redacted readiness result to the next step. The token stays in B's process
environment and is never pasted into a prompt or artifact.

#### Manual pause 7B - authorize the sender

On machine A, the operator must manually:

- configure B's exact peer key, not a URL;
- provision the same token through the local secret mechanism;
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
- receiver denies token, caller key, route enablement, or target key;
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

1. ship route code with remote prompts disabled;
2. verify local worker and peer transport tests on both machines;
3. provision tokens and allowlists manually;
4. enable on B only for a short canary window;
5. run one harmless prompt from A;
6. inspect request ID, identity, timing, and no-leak evidence;
7. enable additional peer keys one at a time;
8. keep the existing commit-sync and Qwen handoff paths unchanged;
9. disable the feature flag to roll back prompt execution;
10. rotate the machine-base peer token if any credential exposure is suspected.

Rollback is the route-disable flag plus process restart/relaunch. It must not
require deleting relay records, changing the Qwen tunnel, resetting a checkout,
or removing unrelated worker functionality. If the new client is incompatible,
the existing peer-ping and commit-sync clients must continue to operate.

## Acceptance gates

- The plan's implementation uses existing Wix keyed tunnel registration and
  exact-key peer discovery rather than a new peer-address database.
- Prompt bodies travel directly to the validated current peer tunnel, not
  through Wix storage or the Qwen handoff relay.
- The receiver is disabled and deny-by-default until manually enabled.
- A separate process-only token and exact caller-key allowlist protect prompt
  execution; `qwenHandoff` and `HANDOFF_TOKEN` remain separate.
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
  remain `unknown_execution_state` and are not blindly retried.
- Focused tests, local worker proof, public canary proof, and unperformed
  broad/runtime proof are reported separately.
- Public canary evidence contains no token, prompt, raw model output, or secret.
- Tunnel rotation, peer restart, unauthorized access, worker timeout, and
  process cleanup remain visible and bounded.
- Disabling the feature restores a state in which no remote prompt can execute;
  existing Qwen handoff and commit coordination remain independently usable.

## Explicit non-goals

Do not add:

- arbitrary remote shell or PowerShell execution;
- arbitrary HTTP proxying or caller-selected peer URLs/routes;
- anonymous public Codex worker access;
- reuse of Qwen ASR or `qwenHandoff` credentials;
- prompt bodies or secrets in Wix collections, Git, Markdown, logs, or memory;
- a durable distributed prompt queue or conversation history;
- automatic fan-out to every registered peer;
- automatic retry after a prompt may have started;
- remote checkout changes, Git operations, force resets, or arbitrary origins;
- caller-controlled model, cwd, environment, sandbox, approval, or executable;
- production enablement without the manual security and canary pauses above.
