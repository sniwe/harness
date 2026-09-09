# audEp unattended run report

Date: 2026-09-09  
Verdict: **BLOCKED / PERFORMANCE FAIL**

## Orchestration result

The harness successfully launched the current app runtime, drove the exact 987 source through the normal browser file-selection path, retained the remote job identity, and observed the job through partial and final ready states. Qwen focused and full test suites passed (`48/48` and `80/80`).

Evidence: [H10 live browser evidence](h10-live-browser-987-evidence.md).

## Joined live identity

- Source revision: `sha256:a1e71260a1c05ac574f02e9cc1a00eba6da332ed1dd430225796c6ce7bc816d4`
- App runtime: `283d741ad7b2bff7e1a32370e76a8f3c147fce71:45768`
- Remote job: `audep-c43b2d49-2fad-40a2-bc5c-092a876aa0de-2e8108d00752a4c697583784c666dd20c18418a3ca62398c1de102dac34f1eb5`
- Protocol: `12.5s-primary-plus-5s-boundary-v1`
- Audio duration: `644655 ms`
- End-to-end browser elapsed time: `1423825 ms`
- Whole-run observed rate: `0.452763x` realtime
- Final Qwen update: sequence `16`, committed frontier `644655 ms`, localization `ready`

## Acceptance disposition

The observed whole-run rate is below the mandatory `0.50x` realtime threshold, so application performance does not pass H10. This full-run ratio is reported as an observation, not substituted for the plan's specified steady interval metric.

Still missing or unverified:

- fixed steady-interval throughput and baseline/candidate comparison cohort;
- independent exact-job source-time, canonical, and beyond-frontier probes;
- six observed-predicate restart tracers;
- bilateral app/Qwen benchmark result objects and final acceptance event;
- complete A0-A7/Q0-Q7 phase evidence and owner-side deployment pinning.

No PASS verdict is issued from upload completion, model readiness, or local test results alone.
