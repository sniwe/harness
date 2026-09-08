# H10 real 987 evidence

Date: 2026-09-08

This is retained evidence from the real normal-browser verifier run. It is not a synthetic rehearsal and is not final acceptance.

## Immutable identities

- Source: `C:\retry\src\backend\data\media\1788683394546-ebc52030-3330-4ddb-92dc-b95d9c76a26d-987-mtmo3aqe-c4b8b6ddfda248.mp3`
- Source SHA-256: `a1e71260a1c05ac574f02e9cc1a00eba6da332ed1dd430225796c6ce7bc816d4`
- Source duration: `644.655601` seconds; app committed through `644655` ms
- App item: `4e95ddd8-a381-4d69-88aa-96f67d91c19e`
- Remote job: `audep-4e95ddd8-a381-4d69-88aa-96f67d91c19e-c928324fdf276e1735e72600936c613b00e0d1dbb21717df3497821a5fd3e789`
- Source audio revision: `sha256:a1e71260a1c05ac574f02e9cc1a00eba6da332ed1dd430225796c6ce7bc816d4`
- App checkout: `2fe8f3c9dd24511f225e6206aad7723a53477b6f`; dev process PID `22132`; port `45673`
- Qwen checkout: `c17a131fe028b2e428b6e80a33d30bb4fa57b8df`; process PID `38332`; port `8000`

## Observed result

- Normal browser file selection/upload: passed
- Verifier elapsed wall time: `1160763` ms
- Intermediate state: `partial/partial` at `239870` ms
- Final audio transcript status: `ready`
- Final semantic transcript status: `ready`
- Final canonical localization status: `ready`
- Final canonical timeline status: `ready`
- Semantic tree nodes reported by verifier: `25`
- Qwen received calls: `103`
- Qwen latest update sequence: `13`
- Qwen final current operation: none
- Qwen durable manifest: `C:\Users\rhyse\Qwen3-ASR\dev\audep-work-a7-260906\jobs\audep-4e95ddd8-a381-4d69-88aa-96f67d91c19e-c928324fdf276e1735e72600936c613b00e0d1dbb21717df3497821a5fd3e789\manifest.json`; SHA-256 `beb4010ae70c5d3df853f10743a555597299de5020aab9e39c69774228a781d4`
- Qwen final update: `updates\00000013.json`; SHA-256 `3faa7850c63ca58b6f08a1fdcc7fb516fddc028bd278215ae4dcbd67f8915f33`; committed audio `644655` ms; localization alignment version `2`
- Qwen required suite: `C:\Users\rhyse\.conda\envs\qwen3-asr\python.exe -m unittest discover -s tests -p "test_audep*.py" -v`; `48/48` passed
- Qwen full suite: same interpreter with `-p "test_*.py" -v`; `80/80` passed

## Missing H10 gates

- No measured committed-throughput metric or source/candidate comparison is attached.
- Required source-time probes, canonical hash, beyond-frontier check, and independent correctness verifier output are not attached.
- No six observed-predicate restart records are attached.
- No bilateral app/Qwen benchmark result objects or final acceptance event are attached.

Disposition: real browser and model completion evidence retained; final H10 acceptance remains `BLOCKED` until the missing gates are produced and joined by exact identity.
