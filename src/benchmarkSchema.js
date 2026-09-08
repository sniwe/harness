const HASH = /^[0-9a-f]{64}$/;
export function validateBenchmarkResult(result) {
  if (!result || result.schemaVersion !== 1 || !result.benchmarkId || !result.runId || !HASH.test(result.requestArtifactId || '') || !result.source?.basename || !Number.isFinite(result.source?.durationMs) || result.source.durationMs < 0 || !result.job?.remoteJobId || !result.runtime?.appGeneration || !result.runtime?.qwenGeneration || !['pass', 'fail', 'blocked'].includes(result.verdict)) throw new Error('benchmark_result_invalid');
  if (result.verdict === 'pass' && (!result.browserEvidence?.normalBrowser || result.localization?.valid !== true || !Number.isFinite(result.metrics?.committedRealtime))) throw new Error('benchmark_pass_evidence_invalid');
  return true;
}
