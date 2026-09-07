# Machine-base launcher diagnostics

Date: 2026-09-07  
Status: implemented locally; peer-side runtime evidence pending  
Target workspace: `C:\\harness`

## Objective

Make launcher and relaunch startup behavior inspectable when `npm start` runs
under Codex or another background process where inherited terminal output is
not visible.

Write a dedicated append-only diagnostic log at:

```text
<MACHINE_BASE_DATA_ROOT or data/machine-base>/logs/launcher.log
```

The launcher remains the process supervisor and continues to mirror output to
the visible console when one exists.

## Requirements

1. Create the `logs` directory before the first child launch.
2. Record launcher lifecycle events with ISO timestamps:
   - launcher start and configured data/log paths;
   - generation and child PID at spawn;
   - child stdout and stderr;
   - child exit code or signal;
   - dedicated relaunch-code detection and backoff delay;
   - launcher shutdown signal.
3. Preserve existing child environment, exit-code behavior, signal forwarding,
   and relaunch generation semantics.
4. Keep writes non-blocking and tolerate log-file errors without taking down a
   healthy machine-base service; continue console forwarding if possible.
5. Redact credentials and secret-like values before writing diagnostic output.
   Never log prompts, model output, auth headers, git credentials, or arbitrary
   request bodies. Log only bounded child output needed for startup diagnosis.
6. Bound disk use with a simple size-based rotation or truncation policy. Keep
   the implementation standard-library-only and document the limit.
7. Ensure shutdown closes the log stream after the child and launcher lifecycle
   event is recorded.

## Phased implementation

### Phase 1 — logging seam

Extend `src/launcher.js` with a small file logger using `node:fs` and
`node:path`. Resolve the log path from `MACHINE_BASE_DATA_ROOT`, create its
parent directory, and open the file in append mode. Add one internal bounded
write helper that timestamps and redacts text.

Do not change `src/server.js` or introduce a logging dependency.

### Phase 2 — child stream tee

Spawn the server with piped stdout/stderr. Tee each chunk to the existing
process console and the launcher log. Mark stream origin (`stdout` or
`stderr`), preserve output ordering as received, and avoid waiting on a log
write before forwarding console output.

Record spawn, exit, signal, relaunch, and shutdown events through the same
helper. Keep the dedicated exit code `75` as the only automatic relaunch
trigger.

### Phase 3 — retention and failure behavior

Implement a minimal bounded policy, for example rename the current log to one
backup when it exceeds a documented size, then continue with a fresh log.
If rotation or append fails, emit a concise console warning once and continue
supervising the child. Do not expose raw filesystem errors containing secrets.

### Phase 4 — focused verification

Add tests with injected filesystem/process seams where practical:

- directory and log creation under a temporary data root;
- timestamped lifecycle records and stdout/stderr capture;
- relaunch on exit `75` and no relaunch on ordinary exit;
- generation and PID records;
- signal forwarding;
- redaction of URL credentials and common secret-like values;
- bounded rotation/truncation;
- log-write failure does not prevent child supervision.

Run the focused launcher tests and `npm test`.

### Phase 5 — real runtime proof

Start `npm start` through the same background/Codex path that hid the prior
foreground output. Verify, using only the filesystem log and process state:

1. launcher start and generation 1 are recorded;
2. worker readiness and tunnel publication are visible;
3. a controlled relaunch records exit `75`, generation 2, and the new child
   PID;
4. the peer sync/relaunch handoff and subsequent startup error, if any, are
   visible without relying on the terminal;
5. no credentials, prompts, or request bodies appear in the log.

Save sanitized output and checks under:

```text
C:\\harness\\mgmt\\dev\\260907\\2\\evidence\\launcher-log-20260907.md
```

## Acceptance criteria

- A hidden/background `npm start` always leaves a useful launcher log.
- The log distinguishes launcher, child stdout, and child stderr events.
- Relaunch generation, exit code, PID, and backoff are auditable.
- Log failures cannot stop service supervision.
- Disk use is bounded and the retention rule is documented.
- Secret-like values and arbitrary control payloads are absent.
- Existing tests pass and real launch/relaunch evidence is recorded.

## Explicit non-goals

Do not add a logging service, database, remote log shipping, UI, periodic
health logger, full request tracing, or a second independent server logger.
