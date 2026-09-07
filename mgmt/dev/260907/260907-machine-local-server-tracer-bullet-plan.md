# Machine-local tunnel relay and Codex machine-base server

Date: 2026-09-07  
Status: plan only; no implementation authorized by this request  
Target workspace: `C:\harness`  
Reference implementations: `C:\tkWatcher\src` and `C:\Users\Admin\Downloads\codex-cli-worker-cross-machine-setup.md`

## Objective

Build a machine-local Node.js server that remains reachable through a rotating ephemeral Cloudflare quick tunnel and exposes a local, supervised Codex `machine-base` worker. The first vertical slice must prove the complete path:

```text
local HTTP server
  -> cloudflared quick tunnel
  -> relay POST containing the current public URL
  -> configured always-online endpoint stores/serves that URL

local HTTP server
  -> active/standby worker child processes
  -> one Codex CLI app-server per child
  -> one initialized Codex thread per child
  -> JSON request/response API
```

The server owns both supervisors. The browser or an external caller never launches `cloudflared` or Codex directly.

## Evidence and constraints from the existing system

### Tunnel path (`C:\tkWatcher`)

- `src/modules/tunnel/cloudflareTunnel.js` launches `cloudflared` with:
  `tunnel --url <localUrl> --no-autoupdate`.
- It reads both stdout and stderr line-by-line and extracts a
  `https://<name>.trycloudflare.com` URL.
- It suppresses duplicate URL publications within one supervisor instance.
- It POSTs JSON to the configured relay URL with exactly:

  ```json
  {"tunnelKey":"<key>","tunnelUrl":"https://...trycloudflare.com"}
  ```

- `scripts/start-with-log.js` recreates the supervisor after startup failure and
  retries after `TUNNEL_RETRY_DELAY_MS` (currently 15 seconds).
- `src/config/tunnelRelayEnv.js` defines the existing environment seam:
  `TUNNEL_RELAY_LOCAL_URL`, `TUNNEL_RELAY_BASE_URL`, `TUNNEL_RELAY_PATH`,
  `TUNNEL_KEY`, and `CLOUDFLARED_PATH`.
- The existing documented relay is
  `https://dev-sitex2082572611.wixdev-sites.org/_functions/tunnelRelay`.
  Its routing key is `tunnelKey`; its stored URL field is `title` in the
  `tunnels` collection.

### Codex worker path (setup document)

- The server must spawn long-lived Node worker children, not a network worker
  service and not a browser-launched Codex process.
- Worker stdout is JSONL protocol only; stderr is diagnostics/readiness.
- Each child owns one long-lived Codex CLI `app-server` launched over
  `stdio://`, one Codex thread, and a FIFO request queue.
- Startup is complete only after `initialize`, `initialized`, `thread/start`, and
  a literal `test` startup turn. The child then emits `[codex-worker] ready`.
- The server should use an active/standby pair, retry a failed logical request
  once on the ready peer, and repair the failed slot in the background.
- On Windows, resolve `CODEX_BIN` first, otherwise use
  `%APPDATA%\\npm\\codex.cmd`, and launch through `cmd.exe /d /s /c`.
- Use `approvalPolicy: "never"`; retain the worker's existing sandbox and output
  schema contract. Do not hard-code a machine-specific thread ID, URL, or model
  response.

## Open contract gate

The request says “endpoint details below,” but no endpoint payload is present in
the supplied message. Before implementation, record and validate these values:

1. always-online relay base URL and path;
2. request authentication, if any;
3. exact `tunnelKey` for this machine-base instance;
4. whether the endpoint only stores the URL or also offers a health/lookup route;
5. expected success status/body and timeout;
6. the local service URL/port that must be exposed;
7. the public API routes, authentication, and allowed machine-base worker tasks.

Until this gate is closed, use the existing Wix contract only as the provisional
default. Never silently reuse `tkWatcher` if this is a second machine: a distinct
key prevents overwriting the existing record.

## Machine-unique tunnel identity

`TUNNEL_KEY` should be a stable logical name derived once per machine, not a
manually typed hostname and not a raw hardware serial exposed to the relay.

### Deterministic identity algorithm

Implement a platform adapter that returns `{ source, value }` candidates in this
order on Windows:

1. `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`;
2. `Win32_ComputerSystemProduct.UUID` from CIM/PowerShell;
3. `Win32_BIOS.SerialNumber` plus `Win32_BaseBoard.SerialNumber`;
4. `Win32_DiskDrive.SerialNumber` for the system disk as a last-resort,
   installation-dependent fallback.

Normalize whitespace/case and reject empty, placeholder, or generic values such as
`To be filled by O.E.M.`. If multiple reliable values are available, canonicalize
the ordered tuple instead of relying on one independently changeable field. Hash
the canonical value with SHA-256 and derive a relay-safe key:

```text
machineBaseId = sha256("machine-base-id:v1:" + canonicalIdentity)
tunnelKey     = "machine-base-" + lowercase(base32(machineBaseId))[0:20]
```

The exact prefix/length remains subject to the relay contract gate. Store the
algorithm version, source type, derived ID, and key in a local setup manifest; do
not store or log raw serial values unless explicitly required for troubleshooting.
The hash is an identifier, not a secret, so relay/API authentication is separate.

If no reliable hardware identity is available, fail closed with a setup error and
offer an explicit operator-approved fallback: generate a cryptographically random
UUID once, persist it locally, and mark the key as `generated-persisted` in status.
Never silently fall back to hostname, username, current IP, or a new random value
on every start. A persisted fallback is stable but is not an objective hardware
identity.

Add an identity command with read-only `--check` mode. It prints only source type,
algorithm version, derived ID, and key. Ordinary startup must never rotate the key
because one hardware probe temporarily failed.

### Collision and ownership checks

Before publishing, perform a relay preflight if the endpoint supports lookup:

- read the current record for the derived key;
- if empty, claim/create it;
- if it matches this installation's known record, update it;
- if it contains another ownership marker, stop and require operator review.

If the endpoint only supports blind POST, add a local ownership file and require a
new operator-approved key when the derived key is already known to be owned by
another installation. Do not assume a hash collision is impossible.

## Proposed repository shape

Keep the first implementation inside this workspace and preserve clear seams:

```text
C:\harness\
  package.json
  src\
    server.js
    config\machineBaseEnv.js
    setup\machineIdentity.js
    setup\machineBaseSetup.js
    modules\
      tunnel\cloudflareTunnelSupervisor.js
      tunnel\tunnelRelayClient.js
      codex\machineBasePool.js
      codex\machineBaseWorkerClient.js
  mgmt\machine-base-worker\
    package.json
    src\index.js
    src\core.js
    src\self-test.js
  data\machine-base\
    setup.json
    identity.json
  test\
    tunnelRelayClient.test.js
    cloudflareTunnelSupervisor.test.js
    machineBasePool.test.js
  mgmt\logs\
```

This is a target shape, not permission to create all files immediately. During
implementation, reuse the existing source if the actual worker package can be
copied from its authoritative checkout; otherwise reconstruct only the documented
protocol seams and mark any parity gap in the implementation report.

## Phased vertical tracer-bullet plan

### Phase 0 — contract, identity, and machine preflight

Define the target machine identity and write a small `.env.example` without real
credentials. Confirm Node.js/ESM, `cloudflared`, `codex --version`, Codex
authentication, writable runtime/log directories, and the chosen local port.

Implement and test the identity adapter before any tunnel process starts. Resolve
the stable identity, derive the key, and write a versioned local identity record.
Make `TUNNEL_KEY` an explicit override only when the operator has chosen it;
otherwise derive it automatically. Log the source type and derived key, never raw
hardware values.

Record the endpoint gate above, especially the unique tunnel key and auth header.
Decide whether the always-online endpoint is only the URL registry or also the
machine-base API ingress. Keep those responsibilities separate unless the supplied
contract explicitly joins them.

Verification: a preflight command prints versions, resolved paths, non-secret
configuration names, derived identity metadata, and fails closed for missing
required values or an untrustworthy identity. Tests cover normalization,
placeholder rejection, source fallback, stable derivation, persisted UUID fallback,
and no raw-value logging.

### Phase 0.5 — idempotent first-run setup

Add a setup state machine that runs before normal service readiness on the first run
of a machine or after an incomplete setup:

```text
uninitialized
  -> acquire setup lock
  -> inspect/derive machine identity
  -> create local directories and versioned config
  -> resolve cloudflared and Codex CLI
  -> validate endpoint contract and tunnel-key ownership
  -> install/verify worker package dependencies
  -> run worker self-test/startup probe
  -> persist setup manifest
  -> ready
```

Persist state atomically after each completed step with schema version, setup
attempt ID, timestamps, derived key, paths, tool versions, and non-secret outcomes.
Recover stale locks only after a process/age check. Re-running setup must validate
and reuse completed steps, while resuming or repairing partial steps. Never mark
setup complete because a child PID exists or because a relay POST returned HTTP
200 alone.

Use deterministic code for identity, filesystem layout, process discovery,
validation, and safety gates. The Codex worker may assist only with non-critical
discovery or operator-facing configuration proposals. Any proposal must be
schema-validated, checked against allowlisted paths/commands, and converted into
an explicit local decision before changing setup state.

Do not ask Codex to invent the machine ID, choose the tunnel key, execute arbitrary
installation commands, handle secrets, or decide whether a conflicting relay row
may be overwritten. If Codex is unavailable, deterministic setup must still
complete wherever required facts are locally discoverable; otherwise report the
exact missing gate.

Verification: run from an empty data directory, rerun with a complete manifest,
interrupt after every step, recover a stale lock, simulate worker unavailability,
and simulate endpoint-preflight failure. Prove the second run does not create a
new ID or spawn duplicate supervisors.

### Phase 1 — smallest local HTTP server and setup status

Create a Node ESM server bound to `127.0.0.1` by default. Add:

- `GET /health` returning process identity, server role, and current tunnel state;
- `GET /status` returning tunnel state and Codex slot state without secrets;
- `GET /setup/status` returning setup phase, schema version, attempt ID, and
  non-secret identity metadata;
- a placeholder or disabled worker route until the worker pool is ready;
- graceful SIGINT/SIGTERM shutdown with idempotent cleanup.

Do not expose the server publicly by binding to all interfaces. Keep request body
limits, request timeouts, and JSON parsing explicit.

Verification: focused HTTP tests prove health/status/setup-status shape, loopback
binding, malformed JSON rejection, and clean shutdown with no surviving child
processes. Setup endpoints must not expose raw hardware identifiers or credentials.

### Phase 2 — tunnel publication vertical slice

Port the `tkWatcher` tunnel supervisor with minimal changes:

1. resolve `CLOUDFLARED_PATH` or the documented machine-local default;
2. spawn `cloudflared tunnel --url <localUrl> --no-autoupdate` with hidden
   Windows windows;
3. consume stdout and stderr as line streams;
4. parse only valid `trycloudflare.com` URLs;
5. publish each new URL using the setup-derived `tunnelKey` to the configured
   relay and verify ownership/lookup where supported;
6. expose current URL and last publication result in `/status`;
7. on pre-ready exit or publication failure, stop the old process, recreate the
   supervisor, and retry with a bounded configurable delay;
8. stop readers and the process tree during shutdown.

The current URL must be updated only after successful relay publication, or the
status model must distinguish `observedUrl` from `publishedUrl`; choose the latter
if rotation can race with a failed POST. Never claim the URL is live merely because
cloudflared printed it.

Verification: unit tests cover URL extraction from both streams, duplicate
suppression, non-2xx relay responses, rotation from URL A to URL B, retry after
exit, and cleanup. A local fake relay plus a fake cloudflared child proves the
end-to-end publication path without touching production data.

### Phase 3 — one machine-base worker child

Implement or import the documented worker package under `mgmt/machine-base-worker`.
The child must:

- accept one-shot and streamed JSONL modes;
- keep stdout protocol-only and diagnostics on stderr;
- resolve and launch Codex CLI `app-server --listen stdio://` using the Windows
  `cmd.exe` path rule;
- create a temporary runtime cwd;
- perform JSON-RPC initialize/initialized/thread-start;
- run the literal startup probe `test`;
- emit `[codex-worker] ready` only after the probe succeeds;
- serialize turns on one thread;
- validate requests and return one normalized JSON envelope per request;
- terminate the Codex child cleanly, with a bounded kill fallback.

Use the actual machine-base task contract once supplied. If it is a general
worker, start with one minimal harmless `ping`/`root`-equivalent task and reject
unknown tasks rather than inventing behavior.

Verification: pure validation tests, fake app-server RPC tests, one-shot smoke
test, streamed JSONL smoke test, stdout/stderr separation check, startup probe
failure check, and a real authenticated `codex app-server` smoke test.

### Phase 4 — supervised active/standby pool

Add `machineBasePool` to the local server:

- create `active` and `standby` slots with independent generation/readiness state;
- spawn children with `process.execPath`, the worker entry path, streamed mode,
  slot identity, hidden Windows windows, and the worker directory as cwd;
- wait for the stderr readiness marker, not merely a PID;
- serialize requests at pool level and slot level;
- apply normal and task-specific timeouts;
- on worker failure, promote an already-ready peer and retry the same logical
  request once;
- repair the failed slot with bounded exponential delay;
- retain last failure, exit, generation, and active-slot diagnostics in status;
- make request IDs/job IDs stable enough for safe retry and document any
  non-idempotent task restriction.

Do not add concurrency beyond the documented serialized one-thread-per-child
model. Do not make thread history durable application state.

Verification: fake-child tests cover readiness timeout, FIFO ordering, timeout
kill, promotion, one retry, repair, both-slots-failed status, and shutdown. A
real two-slot run proves both children become ready and one request returns a
valid normalized response.

### Phase 5 — tunnel plus worker composition

Wire both supervisors into one server lifecycle. Startup order should be:

```text
validate config -> start local HTTP server -> start worker pool -> start tunnel
-> publish URL -> report combined ready status
```

If the endpoint is intended to route requests into this server, only advertise
combined readiness after the local route is healthy and the relay publication has
succeeded. If it is only a URL registry, keep worker readiness independent and
report both states explicitly.

Add structured log fields for `serverPid`, `slot`, `generation`, `requestId`,
`tunnelKey`, observed/published URL, and retry attempt. Redact credentials and
request contents that may contain user data.

Verification: a fake-cloudflared/fake-relay/fake-Codex composition test proves
startup, URL rotation, worker request, relay failure recovery, worker failover,
and orderly shutdown in one run.

### Phase 6 — real machine acceptance and always-online proof

Run the target-machine checklist in this order:

1. run identity preflight and record derived key/source without raw values;
2. run first-run setup from a clean test profile, then repeat it and prove stable
   manifest/key reuse;
3. `codex --version` and resolved `CODEX_BIN`;
4. worker package focused tests and live smoke test;
5. start the local server;
6. confirm active and standby children reach readiness;
7. confirm `/health`, `/status`, and `/setup/status` locally;
8. confirm the exact relay POST succeeds under the derived key and the
   always-online endpoint returns the expected stored/lookup result;
9. make a real worker request through the local API;
10. force a controlled tunnel rotation and verify the endpoint now serves URL B
    for the same derived key;
11. force a controlled worker-slot failure using an isolated test hook and verify
   promotion/retry/repair;
12. stop the server and prove no worker, Codex app-server, or cloudflared
   descendant remains.

Save command output and endpoint responses under
`C:\harness\mgmt\dev\260907\evidence\` with timestamps. Separate focused test
proof, local live proof, endpoint proof, and any unperformed broad-suite claims.

## Acceptance gates

The implementation is complete only when all are true:

- the exact endpoint contract is recorded and used with the intended unique key;
- the key is reproducibly derived from a documented stable machine identity, or
  an explicitly operator-approved persisted UUID fallback is recorded;
- first-run setup is resumable, idempotent, atomic at manifest boundaries, and
  does not require Codex for deterministic safety decisions;
- a generated URL is observed, successfully published, and retrievable through
  the always-online path;
- URL rotation updates the same key without stale publication winning a race;
- active and standby Codex workers both pass the startup probe;
- one real worker request succeeds through the local server;
- a controlled worker failure demonstrates peer retry and background repair;
- shutdown leaves no descendant processes;
- status distinguishes tunnel observed/published/failed state from Codex
  starting/ready/busy/failed state;
- no machine-specific URL, thread ID, secret, or model output is hard-coded;
- tests and live evidence are stored separately and the report says exactly what
  was not tested.

## Risks and explicit non-goals

- A quick tunnel URL is ephemeral; persisted state is only a pointer and must be
  revalidated after restart or rotation.
- Relay HTTP 200 alone is insufficient unless the endpoint response or a lookup
  confirms that the intended key now maps to the new URL.
- A spawned PID is not worker readiness; the startup probe is mandatory.
- A repaired worker has a new Codex thread; callers must not rely on prior thread
  history.
- Do not add authentication, remote multi-tenant routing, arbitrary shell
  execution, worker concurrency, durable job storage, or browser UI until the
  endpoint details and task contract explicitly require them.

## Handoff outputs

Implementation should produce:

1. the local server and worker source under the agreed target shape;
2. focused unit/integration tests with fake child/relay seams;
3. `.env.example` and a machine setup/run document with no secrets;
4. a real verification report under `mgmt/dev/260907` containing endpoint,
   process, URL-rotation, failover, and shutdown evidence;
5. an explicit list of any parity gaps between the imported worker and the setup
   document.
