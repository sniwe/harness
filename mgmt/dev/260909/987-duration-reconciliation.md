# 987 duration reconciliation

Date: 2026-09-09

## Finding

The exact source file is the tracked MP3 in `C:\\retry-harness-run`, with SHA-256 `a1e71260a1c05ac574f02e9cc1a00eba6da332ed1dd430225796c6ce7bc816d4`.

FFprobe reports format and stream duration `644.655601` seconds. Decoding with FFmpeg to mono 16 kHz Float32 produces `10,314,490` samples, or `644,655.625` ms. The protocol uses the corrected-plan rule `floor(decoded duration seconds * 1000)`, therefore the authoritative integer timeline is `644655 ms`.

The former Qwen fixture declared `644702 ms`. Its final primary chunk ended at `644702 ms`, but the final 47 ms are zero samples. That value was historical baseline metadata, not required alignment padding. A corrected local fixture now ends at `644655 ms`, has a `457920`-byte final chunk, and has a recomputed input signature.

## Applied contract

- Harness app duration validation uses floor, matching the app implementation.
- Manifest duration is `644655`.
- Qwen fixture is the corrected local fixture ending in `corrected-644655`.
- No padding is added to the protocol timeline; boundary calls remain only the defined 5-second seam evidence.
- Long-running processing is observed through durable status polling; no processing deadline is encoded.

## Reproduction

```text
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <987.mp3>
ffmpeg -hide_banner -loglevel error -i <987.mp3> -ac 1 -ar 16000 -f f32le <normalized.pcm.f32le>
```
