import { joinBenchmarkResults } from './benchmarkJoin.js';

const REQUIRED_RESTARTS = Object.freeze(['app-during-upload', 'app-after-seal', 'qwen-during-asr', 'qwen-during-constructor', 'qwen-during-alignment', 'app-after-partial-localization']);
const HASH = /^[0-9a-f]{64}$/;

function validRestartEvidence(item) {
  return item?.verdict === 'pass' && HASH.test(item.artifactId || '') && item.trigger?.predicate === item.name && item.before?.runtimeGeneration && item.before?.jobId && item.after?.runtimeGeneration && item.after?.jobId && item.before.runtimeGeneration !== item.after.runtimeGeneration && item.before.jobId === item.after.jobId;
}

export function evaluateFinalAcceptance({ app, qwen, restarts = [], warmCohort, minimumRealtime = 0.5 } = {}) {
  let joined;
  try { joined = joinBenchmarkResults(app, qwen); }
  catch (error) { return { ok: false, verdict: 'blocked', reason: 'benchmark_evidence_invalid', error: error.message }; }
  const names = restarts.map((item) => item?.name); const duplicates = names.filter((name, index) => names.indexOf(name) !== index); const unknown = names.filter((name) => !REQUIRED_RESTARTS.includes(name));
  if (duplicates.length || unknown.length) return { ok: false, verdict: 'blocked', reason: 'restart_matrix_invalid', duplicates: [...new Set(duplicates)], unknown: [...new Set(unknown)], joined };
  const seen = new Map(restarts.map((item) => [item.name, item])); const missing = REQUIRED_RESTARTS.filter((name) => !validRestartEvidence(seen.get(name)));
  if (joined.verdict !== 'pass') return { ok: false, verdict: 'blocked', reason: 'bilateral_benchmark_failed', joined };
  if (![app.metrics.committedRealtime, qwen.metrics.committedRealtime].every((value) => Number.isFinite(value) && value >= minimumRealtime)) return { ok: false, verdict: 'failed', reason: 'throughput_below_minimum', observed: { app: app.metrics.committedRealtime, qwen: qwen.metrics.committedRealtime }, minimumRealtime, joined };
  if (missing.length) return { ok: false, verdict: 'blocked', reason: 'restart_evidence_missing_or_failed', missing, joined };
  const cohorts = warmCohort || {};
  const invalidCohort = ['app', 'qwen'].find((name) => !isValidWarmCohort(cohorts[name], minimumRealtime));
  if (invalidCohort) return { ok: false, verdict: 'blocked', reason: 'warm_cohort_missing_or_failed', project: invalidCohort, joined };
  return { ok: true, verdict: 'pass', joined, warmCohort, restartCount: REQUIRED_RESTARTS.length, minimumRealtime };
}

function isValidWarmCohort(cohort, minimumRealtime) {
  return cohort?.ok === true && cohort.verdict === 'pass' && Number(cohort.observedRuns) >= 3 && Number(cohort.medianRealtime) >= minimumRealtime && Number(cohort.range?.minimum) >= minimumRealtime;
}

export function recordFinalAcceptance({ store, app, qwen, restarts = [], warmCohort, minimumRealtime = 0.5 } = {}) {
  if (!store?.append) throw new Error('final_acceptance_store_required');
  const result = evaluateFinalAcceptance({ app, qwen, restarts, warmCohort, minimumRealtime });
  store.append({ type: 'final_acceptance_evaluated', runId: result.joined?.runId || app?.runId || qwen?.runId || '', benchmarkId: result.joined?.benchmarkId || app?.benchmarkId || qwen?.benchmarkId || '', remoteJobId: result.joined?.remoteJobId || app?.job?.remoteJobId || qwen?.job?.remoteJobId || '', verdict: result.verdict, reason: result.reason, error: result.error, missing: result.missing || [], restartCount: restarts.length });
  return result;
}

export { REQUIRED_RESTARTS };
export { validRestartEvidence };
