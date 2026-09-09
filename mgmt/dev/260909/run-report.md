# audEp unattended run report

Date: 2026-09-09  
Run: `audep-speed-260909-r3`  
Plan digest: `742e8570301ba95d0634d8326e233696a6159cfbf85f3ef4ce665068d1edc11c`  
Orchestration verdict: **ACCEPTED**  
End-to-end plan verdict: **INCOMPLETE**

## Execution result

All 17 scheduled phases A0–A7/Q0–Q7 succeeded once. The exact 987 source was uploaded through the normal browser path twice during the run; both results reached audio and semantic `ready` with 52 tree nodes. The durable controller closed the run as `accepted`.

Evidence: `C:\trendbase\mgmt\logs\runs\audep-speed-260909-r3\state.json` and its command logs.

Observed browser elapsed times:

- A4: `669697 ms`; source duration `644655 ms`; observed rate `0.9626x` realtime.
- A6/A7 final pass: `661397 ms`; source duration `644655 ms`; observed rate `0.9747x` realtime.
- Isolated candidate warm run 3: `1083114 ms`; source duration `644655 ms`; observed rate `0.5954x` realtime; audio/semantic `ready`, 52 tree nodes. The item briefly remained partial while Qwen was ready, then converged through persistent polling.

These observations exceed the mandatory `0.50x` threshold, but they are not a three-warm-run steady-state cohort.

## Joined identities

- Source: exact 987 file; source audio revision `sha256:a1e71260a1c05ac574f02e9cc1a00eba6da332ed1dd430225796c6ce7bc816d4`.
- Harness run: `audep-speed-260909-r3`.
- App runtime observed during execution: `380c622ae081bb234156d45c9973d495c41b3cd7:25700`.
- Qwen authoritative checkout: `C:\Users\rhyse\Qwen3-ASR` using `C:\Users\rhyse\.conda\envs\qwen3-asr\python.exe`.
- Protocol: `12.5s-primary-plus-5s-boundary-v1`.

## Phase evidence

The run state contains pass evidence for every phase, including benchmark output for Q2–Q5 and A7, and release evidence for Q7. Qwen ran the focused audEp suite for Q0–Q6 and the full suite for Q7. The real browser verifier supplied the A4, A6, and A7 acceptance evidence.

## Remaining mandatory gates

- Six observed-predicate restart tracers were not executed.
- Staged deployment, independent supervisor restart, unhealthy-candidate rollback, and post-restart generation pinning were not proven. The post-run scoped app restart was rejected by local execution policy; the runtime therefore remains the pre-fix `380c622` generation.
- The pushed app commit `584d980` was independently started and health-verified as an isolated candidate on port 3103 (`runtimeGeneration=584d980:2660`), then cleanly stopped. This proves candidate startup, not live replacement or rollback.
- The same candidate completed a fresh exact-987 normal-browser run: `678269 ms`, audio/semantic `ready`, 52 tree nodes, observed rate `0.9504x` realtime. This is a second single-run observation, not the required three-warm-run cohort.
- A second isolated-candidate warm run also completed: `918827 ms`, audio/semantic `ready`, 52 tree nodes, observed rate `0.7016x` realtime. The spread demonstrates why a fixed steady-interval cohort and pinned resource conditions are still required.
- A third isolated-candidate warm run completed: `1083114 ms`, audio/semantic `ready`, 52 tree nodes, observed rate `0.5954x` realtime. Three observations now exist, but they span separate candidate processes and are not yet a formally controlled steady-state cohort.
- Bilateral Qwen final-acceptance event and exact benchmark result join were not independently recorded.
- No three-warm-run baseline/candidate cohort or fixed steady-interval performance report exists.
- Reboot-with-logon and boot-without-logon capabilities remain unverified and must remain distinct from process restart.

## Harness verification update

The scoped service controller now records `unknown/process_ownership_lost` when termination ownership is unavailable instead of claiming a clean stop. Focused restart/deployment verification passed 13/13; the complete harness suite passed 156 tests, with 1 platform-skipped test and 0 failures. This closes the ownership-fencing implementation defect, but does not substitute for the six live application/Qwen restart tracers above.

The deployment manager now has a durable `executeRollback` path: it executes the persisted scoped restore command once, persistently observes the previous healthy generation, and preserves an explicit running/cancelled state. Focused deployment verification is 6/6; the latest complete harness suite is 158 passed, 1 skipped, 0 failed.

The restart matrix now has a durable coordinator: it records each restart intent before the side effect, records full completion evidence afterward, resumes validated completed tracers, and blocks unresolved post-crash intents instead of replaying them. Rehearsal now accepts that coordinator and carries its six-tracer output into the report/final-acceptance path. The latest complete harness suite is 166 passed, 1 skipped, 0 failed.

No end-to-end PASS is claimed from phase completion, upload completion, model readiness, or local test results alone.
