# H0 source-duration blocker

Observed 2026-09-09 from the configured `audep-speed-260908` manifest:

| Observation | Value |
|---|---|
| App source | `C:\\retry\\src\\backend\\data\\media\\1788683394546-ebc52030-3330-4ddb-92dc-b95d9c76a26d-987-mtmo3aqe-c4b8b6ddfda248.mp3` |
| Source SHA-256 | `sha256:a1e71260a1c05ac574f02e9cc1a00eba6da332ed1dd430225796c6ce7bc816d4` |
| App `ffprobe` format duration | `644.655601 s` (`644655 ms` with the harness rounding rule) |
| Qwen fixture `mediaDurationMs` | `644702 ms` |
| Plan baseline | `644.702 s`, 103 calls, `12.5s-primary-plus-5s-boundary-v1` |

The app source hash and Qwen fixture source hash agree, but the duration authorities do not. The app implementation uses the MP3 container duration for its durable job, while the Qwen fixture endpoint is 47 ms longer. H0 therefore remains blocked rather than silently treating the values as interchangeable. A contract owner must either provide a canonical duration authority (and preserve both observed values) or regenerate the fixture/app evidence. No timeout relaxation or duration tolerance is authorized by this record.

Other current preflight blockers are independently reported: the configured app endpoint returns HTTP 404 instead of the required capability response, and the manifest has no verified command map for the 17 phase steps. These are not resolved by this artifact.
