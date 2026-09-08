import crypto from 'node:crypto';
import { validateBenchmarkResult } from './benchmarkSchema.js';
import { createBenchmarkStore } from './benchmarkStore.js';

export function createBenchmarkCoordinator({ store, runId, maxConcurrent = 1 } = {}) {
  const durable = store?.dir ? createBenchmarkStore(store.dir) : null;
  const local = new Set();
  const running = () => durable?.list().filter((item) => item.status === 'running').length || 0;
  async function execute(request, runner, { benchmarkId = crypto.randomUUID() } = {}) {
    const existing = durable?.inspect(benchmarkId);
    if (existing?.status === 'succeeded' || existing?.status === 'failed') return existing.result;
    if (local.has(benchmarkId)) throw new Error('benchmark_already_running');
    const active = durable ? running() - (existing?.status === 'running' ? 1 : 0) : local.size;
    if (active >= maxConcurrent) throw new Error('benchmark_capacity_exhausted');
    local.add(benchmarkId);
    durable?.begin({ benchmarkId, runId, request });
    try { const result = await runner({ ...request, benchmarkId, runId }); validateBenchmarkResult(result); durable?.finish(benchmarkId, result); store?.append?.({ type: 'benchmark_result', runId, benchmarkId, verdict: result.verdict }); return result; }
    catch (error) { durable?.update(benchmarkId, { status: 'failed', error: error.message }); throw error; }
    finally { local.delete(benchmarkId); }
  }
  return { execute, inspect: (benchmarkId) => durable?.inspect(benchmarkId) || null, get active() { return durable ? running() : local.size; } };
}
