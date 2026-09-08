import crypto from 'node:crypto';
import { validateBenchmarkResult } from './benchmarkSchema.js';

export function createBenchmarkCoordinator({ store, runId, maxConcurrent = 1 } = {}) {
  let active = 0;
  async function execute(request, runner) {
    if (active >= maxConcurrent) throw new Error('benchmark_capacity_exhausted');
    active += 1; const benchmarkId = crypto.randomUUID();
    try { const result = await runner({ ...request, benchmarkId, runId }); validateBenchmarkResult(result); store?.append?.({ type: 'benchmark_result', runId, benchmarkId, verdict: result.verdict }); return result; }
    finally { active -= 1; }
  }
  return { execute, get active() { return active; } };
}
