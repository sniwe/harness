# H10 live browser 987 evidence

Captured: 2026-09-09

This is the completed normal-browser 987 tracer run against the current app source. It is retained evidence for the benchmark slice, not final bilateral acceptance.

## Run identity

- Browser verifier handle: `61565`
- Browser elapsed time: `1423825 ms`
- App item: `c43b2d49-2fad-40a2-bc5c-092a876aa0de`
- Source audio revision: `sha256:a1e71260a1c05ac574f02e9cc1a00eba6da332ed1dd430225796c6ce7bc816d4`
- Remote job: `audep-c43b2d49-2fad-40a2-bc5c-092a876aa0de-2e8108d00752a4c697583784c666dd20c18418a3ca62398c1de102dac34f1eb5`
- App commit: `283d741ad7b2bff7e1a32370e76a8f3c147fce71`
- App runtime generation: `283d741ad7b2bff7e1a32370e76a8f3c147fce71:45768`
- App tunnel key: `chinApp`
- Qwen process identity observed by health: `38332`
- Protocol: `12.5s-primary-plus-5s-boundary-v1`

## Observed result

- Browser upload: completed through the normal file-selection UI.
- First processing transition: `560794 ms`, both transcript states `partial`, semantic tree present.
- Final transition: `1423824 ms`, audio and semantic transcript states `ready`, semantic tree present with 33 nodes.
- Qwen update sequence: `16`
- Qwen committed frontier: `644655 ms`
- Qwen localization: `ready`
- Qwen localization revision: `sha256:0b4d04da172eed61b265bee614ac0749e5afb5c0e9834cb463b4d61dd59b4adb`
- Qwen alignment wall time: `826386.6 ms`

## Explicit limits

This artifact does not prove measured realtime throughput, a baseline/candidate cohort, independent source-time and beyond-frontier probes, any of the six restart tracers, or bilateral app/Qwen final acceptance. Those remain required H10 gates.
