# Commit-sync local launch evidence

Date: 2026-09-07  
Checkout: `C:\harness`  
Commit: `fffe9654ccd2fd8f1bc238e086df3d024c382537`

## Focused automated proof

`npm test`: 14 passed, 1 skipped (Linux-only identity case on Windows).

Covered deterministic checkout validation, exact peer-ping behavior, worker
readiness/failover, tunnel publication/rotation, and setup behavior.

## Real launch proof

With `MACHINE_BASE_FAKE=1` and peer coordination disabled for isolation:

- active and standby worker slots initialized and emitted readiness;
- the launch worker confirmed the exact full commit above;
- startup reached `tunnel_ready`;
- quick tunnel publication reached `running` with a non-empty URL;
- `POST /api/machine-base/commit-status` returned HTTP 200 without token
  authentication;
- temporary workers and cloudflared were stopped after the probe.

Peer pull/relaunch remains intentionally paused until this commit is manually
propagated and relaunched on the other machine.
