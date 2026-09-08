import fs from 'node:fs';
import path from 'node:path';

export function resolveAppBenchmarkAdapter({ projectRoot, verifier, source } = {}) {
  if (!projectRoot || !verifier || !source) throw new Error('app_benchmark_adapter_invalid');
  const verifierPath = path.resolve(projectRoot, verifier); const sourcePath = path.isAbsolute(source) ? source : path.resolve(projectRoot, source);
  if (!fs.existsSync(verifierPath)) throw new Error('app_benchmark_verifier_missing');
  if (!/\b987(?:[ _-]|$)/i.test(path.basename(sourcePath)) || !sourcePath.toLowerCase().endsWith('.mp3')) throw new Error('app_987_source_invalid');
  if (!fs.existsSync(sourcePath)) throw new Error('app_987_source_missing');
  return { projectRoot, verifier: verifierPath, source: sourcePath, command: process.execPath, args: [verifierPath], env: { AUDEP_987_SOURCE: sourcePath } };
}
