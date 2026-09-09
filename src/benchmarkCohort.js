import { validateBenchmarkResult } from './benchmarkSchema.js';

export function evaluateWarmBenchmarkCohort(results, { minimumRuns = 3, minimumRealtime = 0.5 } = {}) {
  if (!Array.isArray(results) || results.length < minimumRuns) return { ok: false, verdict: 'blocked', reason: 'warm_cohort_insufficient_runs', observedRuns: Array.isArray(results) ? results.length : 0, minimumRuns };
  for (const result of results) validateBenchmarkResult(result);
  const identity = results[0]; const fields = ['runId', 'source.basename', 'source.durationMs', 'source.sha256', 'source.revision', 'source.planVersion', 'source.callCount', 'manifestDigest', 'runtime.qwenGeneration'];
  const mismatch = fields.find((field) => results.some((result) => readPath(result, field) !== readPath(identity, field)));
  const ids = new Set(results.map((result) => result.benchmarkId));
  if (mismatch || ids.size !== results.length || results.some((result) => result.warm !== true || !result.configurationDigest || result.configurationDigest !== identity.configurationDigest)) return { ok: false, verdict: 'blocked', reason: 'warm_cohort_identity_mismatch', field: mismatch || (ids.size !== results.length ? 'benchmarkId' : 'warm/configurationDigest') };
  const rates = results.map((result) => result.metrics.committedRealtime).sort((a, b) => a - b); const median = rates[Math.floor(rates.length / 2)]; const range = { minimum: rates[0], maximum: rates.at(-1) };
  return { ok: rates.every((rate) => rate >= minimumRealtime), verdict: rates.every((rate) => rate >= minimumRealtime) ? 'pass' : 'failed', minimumRuns, observedRuns: results.length, minimumRealtime, medianRealtime: median, range, benchmarkIds: results.map((result) => result.benchmarkId), configurationDigest: identity.configurationDigest };
}

function readPath(value, field) { return field.split('.').reduce((current, part) => current?.[part], value); }
