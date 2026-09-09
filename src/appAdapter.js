import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function resolveAppBenchmarkAdapter({ projectRoot, verifier, source, appUrl = 'http://127.0.0.1:3000', sourceAudioRevision, durationMs, ffprobePath = process.env.FFPROBE_PATH || 'ffprobe' } = {}) {
  if (!projectRoot || !verifier || !source || !/^https?:\/\/[^\s]+$/.test(appUrl)) throw new Error('app_benchmark_adapter_invalid');
  const verifierPath = path.resolve(projectRoot, verifier); const sourcePath = path.isAbsolute(source) ? source : path.resolve(projectRoot, source);
  if (!fs.existsSync(verifierPath)) throw new Error('app_benchmark_verifier_missing');
  if (!/\b987(?:[ _-]|$)/i.test(path.basename(sourcePath)) || !sourcePath.toLowerCase().endsWith('.mp3')) throw new Error('app_987_source_invalid');
  if (!fs.existsSync(sourcePath)) throw new Error('app_987_source_missing');
  const digest = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex')}`;
  if (sourceAudioRevision && sourceAudioRevision !== digest) throw new Error('app_987_source_revision_mismatch');
  let measuredDurationMs;
  if (durationMs !== undefined) { try { measuredDurationMs = Math.round(Number(execFileSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', sourcePath], { encoding: 'utf8' }).trim()) * 1000); } catch { throw new Error('app_987_duration_probe_failed'); } if (!Number.isFinite(measuredDurationMs) || measuredDurationMs !== durationMs) throw new Error(`app_987_duration_mismatch:expected=${durationMs}:measured=${measuredDurationMs}`); }
  return { projectRoot, verifier: verifierPath, source: sourcePath, sourceAudioRevision: digest, ...(measuredDurationMs === undefined ? {} : { durationMs: measuredDurationMs }), appUrl, command: process.execPath, args: [verifierPath], env: { AUDEP_987_SOURCE: sourcePath, AUDEP_APP_URL: appUrl } };
}
