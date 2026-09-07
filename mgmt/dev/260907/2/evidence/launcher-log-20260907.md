# Launcher diagnostics evidence

Date: 2026-09-07  
Workspace: `C:\\harness`  
Implementation commits: `7bd2ed6`, `e2c3975`, `e31db16`

## Focused verification

```text
npm test
tests 20
pass 19
skipped 1
fail 0
```

Launcher-focused tests cover temporary log creation, ISO timestamps,
credential/secret-like redaction, one-backup rotation, stdout/stderr teeing,
exit-75 relaunch, generation/PID records, and signal forwarding.

## Local runtime verification

The latest launcher was started through `npm start` with coordination disabled
for an isolated startup probe. The log was inspected without relying on the
terminal:

```text
C:\\harness\\data\\machine-base\\logs\\launcher.log
launcher_start dataRoot=... logPath=...
spawn generation=1 pid=43012
child_stdout [worker:active] ... startup
child_stdout [worker:standby] ... startup
child_stdout [worker:active] ... ready
child_stdout [worker:standby] ... ready
child_stdout [tunnel] published ...trycloudflare.com
child_stdout {"ready":true,...}
shutdown_signal SIGINT
exit generation=1 pid=43012 code=null signal=SIGINT
```

The file was present, appendable, and the captured sample contained no
credentials, prompts, model output, or request bodies. The current log uses a
5 MiB file limit and keeps one `.1` backup.

## Two-machine acceptance

An intentional README fast-forward was pushed as `e31db16`. The local machine
restarted with that target and coordinated the peer. The peer tunnel rotated
from `foo-dramatic-economic-appeals.trycloudflare.com` through a transient
outage to `chronicles-rebate-hopes-hydrogen.trycloudflare.com`.

Final public status from both exact machine keys:

```text
local: commit=e31db167... clean=true confirmed=true tunnelReady=true generation=1 startup=converged
peer:  commit=e31db167... clean=true confirmed=true tunnelReady=true generation=2 startup=converged
```

The peer generation-2 status was captured after relaunch with the target
commit and a newly published tunnel. Both public commit-status calls returned
confirmed target hashes. Local-to-peer and peer-to-local ping checks both
returned HTTP 200 after rotation.

## Peer acceptance

The peer's launcher log remains on the other machine and was not copied into
this checkout, but the public generation-2 status and tunnel rotation prove
the relaunch path. It can be inspected at:

```text
<peer checkout>\\data\\machine-base\\logs\\launcher.log
```
