import { validateBenchmarkResult } from './benchmarkSchema.js';

export function joinBenchmarkResults(app, qwen) {
  validateBenchmarkResult(app); validateBenchmarkResult(qwen);
  const fields = [['runId', app.runId, qwen.runId], ['requestArtifactId', app.requestArtifactId, qwen.requestArtifactId], ['source.basename', app.source.basename, qwen.source.basename], ['source.durationMs', app.source.durationMs, qwen.source.durationMs], ['job.remoteJobId', app.job.remoteJobId, qwen.job.remoteJobId], ['runtime.appGeneration', app.runtime.appGeneration, qwen.runtime.appGeneration], ['runtime.qwenGeneration', app.runtime.qwenGeneration, qwen.runtime.qwenGeneration]];
  const mismatch = fields.find(([, left, right]) => left !== right); if (mismatch) throw new Error(`benchmark_identity_mismatch:${mismatch[0]}`);
  if (app.benchmarkId !== qwen.benchmarkId) throw new Error('benchmark_id_mismatch');
  return { schemaVersion: 1, benchmarkId: app.benchmarkId, runId: app.runId, requestArtifactId: app.requestArtifactId, remoteJobId: app.job.remoteJobId, appVerdict: app.verdict, qwenVerdict: qwen.verdict, verdict: app.verdict === 'pass' && qwen.verdict === 'pass' ? 'pass' : 'blocked', joinedAt: new Date().toISOString() };
}
