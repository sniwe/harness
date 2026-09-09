# AudEp phase execution evidence

Date: 2026-09-09

Manifest: `audep-speed-260908`

Plan digest: `c57c1e1a5e5873cec610f36aafeaf77fa5925041cae28b6cc4a3d0ea1c3f4376`

Fresh executions through `src/phaseCommand.js`:

- A0 / `a0-observability`: pass; artifact `086ebf3cd0f61ace67bf3662c6bab35b04d6c8926d719fc61ebc4400a1e5154e`.
- A1 / `a1-byte-hash`: pass; artifact `30dbbc81424acf6ea4e130c51a88919f742884ca622b7f950282748386866ca2`.
- Q0 / `q0-baseline`: pass; artifact `b8a3d21e75b99e4fc73a6a8f294b180d0920c7ce583fb76585c549449ff93600`.

Q0 used `C:\Users\rhyse\.conda\envs\qwen3-asr\python.exe -m unittest discover -s tests -p test_audep*.py -v` in the authoritative local `C:\Users\rhyse\Qwen3-ASR` checkout; 48 tests passed.

These are phase-command execution proofs, not final H10 acceptance. The real 987 browser run remains correct but below the required `0.50x` throughput threshold, and restart-matrix/bilateral acceptance evidence is still outstanding.
