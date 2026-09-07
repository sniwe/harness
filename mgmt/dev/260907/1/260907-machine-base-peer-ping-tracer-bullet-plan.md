# Machine-base peer ping listeners and handlers

Date: 2026-09-07  
Status: plan only; no implementation authorized by this request  
Target workspace: `C:\harness`  
Related plan: `C:\harness\mgmt\dev\260907\0\260907-machine-local-server-tracer-bullet-plan.md`  
Peer registry: `https://dev-sitex2082572611.wixdev-sites.org/_functions/tunnels`

## Objective

Add the smallest useful peer-liveness vertical slice to the existing
machine-base server:

```text
machine A -> public tunnel URL of machine B -> B accepts ping -> pong response
machine A <- Wix tunnels collection <- discovers B's current URL by tunnelKey
```

The first slice proves incoming and outgoing pings between two independently
running machine-base instances. It does not add remote task execution, message
queues, retries across arbitrary peers, or a general mesh protocol.

## Existing contract to use

The Wix HTTP API is public and read-only for discovery:

- `GET /_functions/tunnels` returns all tunnel items.
- `GET /_functions/tunnels?tunnelKey=<value>` returns only exact, trimmed,
  case-sensitive matches.
- The response contains `items`, `count`, and normalized `tunnelKey` (`null`
  for an unfiltered request).
- Each item currently exposes `title` as the public tunnel URL and
  `tunnelKey` as the peer identity.

The local server already publishes its own rotating URL through the relay under
its stable machine-base key. Discovery must use the returned `title` only after
validating that it is an HTTPS `trycloudflare.com` URL and that the returned
`tunnelKey` exactly equals the requested key. Do not use substring matching or
infer a peer from a title.

## Minimal protocol

Add one incoming route:

```text
GET /api/machine-base/ping
```

Response on success:

```json
{
  "ok": true,
  "tunnelKey": "<this machine's key>",
  "serverRole": "machine-base",
  "time": "<ISO timestamp>"
}
```

The route must be side-effect free and must not invoke Codex. Return a bounded
JSON response with an explicit timeout and no secrets, machine hardware values,
request headers, or worker output.

Add one outgoing operation, initially exposed as:

```text
POST /api/machine-base/peer-ping
{"tunnelKey":"<peer key>"}
```

The handler should:

1. validate one non-empty peer key and reject the local key;
2. fetch the exact peer record from the Wix registry;
3. validate the registry response and derive `<peer-url>/api/machine-base/ping`;
4. issue a bounded `GET` with an `AbortSignal` timeout;
5. validate `200`, JSON shape, `ok === true`, and the expected peer key;
6. return normalized result data, elapsed time, and the resolved peer URL.

Do not accept an arbitrary URL from the caller. Do not follow redirects. Do not
retry in the first slice. Treat registry failure, missing peer, malformed URL,
timeout, non-2xx response, invalid JSON, and identity mismatch as visible
failures with suitable 4xx/5xx status, without leaking response bodies.

Use a shared secret only if the existing deployment contract supplies one. If
the public tunnel makes the ping route reachable without authentication, keep
the route limited to liveness metadata and document that it is not an identity
or authorization mechanism. Do not invent a new credential exchange in this
slice.

## Phased vertical tracer-bullet plan

### Phase 0 — contract and seams

Confirm the existing server entrypoint, route conventions, tunnel-key source,
and relay/discovery base URL configuration. Define the smallest internal seams:

- `tunnelRegistryClient`: exact-key lookup and response validation;
- `peerPingClient`: URL construction, timeout, redirect policy, and response
  validation;
- incoming ping handler: local read-only status response;
- outgoing route handler: input validation and error mapping.

Reuse the existing config and HTTP dependency seams. Keep the registry URL
configurable, with the documented Wix URL as the current default. No new
database, scheduler, background peer scan, or worker-pool dependency.

Verification: focused tests define the response/error contracts before wiring;
the real registry is queried read-only for one known key and one missing key.

### Phase 1 — incoming ping

Implement `GET /api/machine-base/ping` on the existing loopback server so it is
automatically reachable through the already-published tunnel. Return only the
current stable tunnel key, fixed server role, timestamp, and `ok`.

Verification: local request returns the exact JSON contract, repeated requests
do not alter setup/tunnel/worker state, malformed methods are rejected, and the
route remains independent of Codex readiness.

### Phase 2 — exact registry lookup

Implement the Wix lookup client using `tunnelKey=<encodeURIComponent(key)>`.
Validate HTTP status, JSON object shape, count/items consistency where present,
exact key equality, and the HTTPS `trycloudflare.com` URL in `title`. Return a
single normalized peer record to the caller.

Verification: fake responses cover one match, no match, duplicate matches,
wrong-case/substring contamination, malformed JSON, non-2xx status, and an
invalid or non-HTTPS title. A live read proves the known `tkWatcher` record and
the current machine-base record without changing Wix data.

### Phase 3 — one outgoing peer ping

Wire `POST /api/machine-base/peer-ping` to the registry client and ping client.
Use one request timeout and one overall bounded operation. Return the peer key,
URL, HTTP status, and validated pong; return no raw upstream body on failure.

Verification: two local server instances or a fake peer prove the complete
outgoing path from key lookup through incoming `/ping` and validated response.
Prove that the caller cannot override the resolved URL and that a peer-key
mismatch fails closed.

### Phase 4 — live two-machine proof

Run two isolated machine-base instances with distinct keys and tunnel/relay
records. Confirm, in order:

1. both local `/api/machine-base/ping` routes respond;
2. the Wix registry returns each current URL under its exact key;
3. machine A successfully pings machine B by B's `tunnelKey`;
4. machine B successfully pings machine A;
5. rotating one quick-tunnel URL still allows discovery and ping under the same
   key;
6. stopping one instance produces a bounded, visible failure from the other.

Save local responses, registry responses, public URLs, timestamps, and process
cleanup evidence under `C:\harness\mgmt\dev\260907\1\evidence\`. Redact any
credentials and distinguish focused test proof from live public-path proof.

## Acceptance gates

- Incoming ping is side-effect free, bounded, and independent of Codex.
- Outgoing ping accepts a peer key, never an arbitrary URL.
- Discovery uses the Wix endpoint's exact-key semantics and current `title` URL.
- Only validated HTTPS quick-tunnel URLs are contacted, with redirects disabled.
- Upstream failures, timeouts, malformed responses, and identity mismatches are
  visible and bounded; no silent retry or stale URL fallback exists.
- Two running instances can ping each other through their current public URLs.
- Tunnel rotation preserves logical peer identity and is rediscovered correctly.
- No remote task execution, arbitrary proxying, durable jobs, or mesh scheduler
  is included in this change.

## Explicit non-goals

Do not add ping fan-out, periodic heartbeats, peer caching, automatic peer
restarts, Codex calls from ping, arbitrary proxy routes, or authentication
protocol changes until a later request supplies those requirements.
