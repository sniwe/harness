# Launcher diagnostics evidence

Date: 2026-09-07  
Workspace: `C:\\harness`  
Implementation commits: `7bd2ed6`, `e2c3975`

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

## Peer acceptance

The peer previously wrote a relaunch handoff for target `6f2718c` and
generation `2`, but its launcher log is on the other machine and was not
available for direct inspection in this run. Peer-side exit-75 consumption,
generation-2 startup, and automatic convergence therefore remain pending
manual collection from:

```text
<peer checkout>\\data\\machine-base\\logs\\launcher.log
```
