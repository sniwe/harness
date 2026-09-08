import { joinBenchmarkResults } from './benchmarkJoin.js';

const REQUIRED_RESTARTS = Object.freeze(['app-during-upload', 'app-after-seal', 'qwen-during-asr', 'qwen-during-constructor', 'qwen-during-alignment', 'app-after-partial-localization']);

export function evaluateFinalAcceptance({ app, qwen, restarts = [], minimumRealtime = 0.5 } = {}) {
  const joined = joinBenchmarkResults(app, qwen); const seen = new Map(restarts.map((item) => [item.name, item])); const missing = REQUIRED_RESTARTS.filter((name) => seen.get(name)?.verdict !== 'pass');
  if (joined.verdict !== 'pass') return { ok: false, verdict: 'blocked', reason: 'bilateral_benchmark_failed', joined };
  if (![app.metrics.committedRealtime, qwen.metrics.committedRealtime].every((value) => Number.isFinite(value) && value >= minimumRealtime)) return { ok: false, verdict: 'failed', reason: 'throughput_below_minimum', observed: { app: app.metrics.committedRealtime, qwen: qwen.metrics.committedRealtime }, minimumRealtime, joined };
  if (missing.length) return { ok: false, verdict: 'blocked', reason: 'restart_evidence_missing_or_failed', missing, joined };
  return { ok: true, verdict: 'pass', joined, restartCount: REQUIRED_RESTARTS.length, minimumRealtime };
}

export { REQUIRED_RESTARTS };
