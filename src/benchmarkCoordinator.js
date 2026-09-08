import crypto from 'node:crypto';
import { validateBenchmarkResult } from './benchmarkSchema.js';
import { createBenchmarkStore } from './benchmarkStore.js';

export function createBenchmarkCoordinator({ store, runId, maxConcurrent = 1 } = {}) {
  const durable = store?.dir ? createBenchmarkStore(store.dir) : null;
  const local = new Set();
  const running = () => durable?.list().filter((item) => item.status === 'running').length || 0;
  async function execute(request, runner, { benchmarkId = crypto.randomUUID() } = {}) {
    const existing = durable?.inspect(benchmarkId);
    if (existing?.status === 'succeeded') return existing.result;
    if (existing?.status === 'failed') throw new Error(existing.error || 'benchmark_failed');
    if (local.has(benchmarkId)) throw new Error('benchmark_already_running');
    const active = durable ? running() - (existing?.status === 'running' ? 1 : 0) : local.size;
    if (active >= maxConcurrent) throw new Error('benchmark_capacity_exhausted');
    local.add(benchmarkId);
    durable?.begin({ benchmarkId, runId, request });
    try { const result = await runner({ ...request, benchmarkId, runId }); validateBenchmarkResult(result); durable?.finish(benchmarkId, result); store?.append?.({ type: 'benchmark_result', runId, benchmarkId, verdict: result.verdict }); return result; }
    catch (error) { durable?.update(benchmarkId, { status: 'failed', error: error.message }); throw error; }
    finally { local.delete(benchmarkId); }
  }
  async function wait(benchmarkId, { observe, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs = 1000, signal } = {}) {
    if (!durable || typeof observe !== 'function') throw new Error('benchmark_wait_invalid');
    while (true) {
      if (signal?.aborted) throw new Error('benchmark_wait_cancelled');
      const current = durable.inspect(benchmarkId); if (!current) throw new Error('benchmark_not_found');
      if (current.status === 'succeeded') return current.result;
      if (current.status === 'failed') throw new Error(current.error || 'benchmark_failed');
      const observed = await observe({ benchmarkId, runId });
      if (observed?.status === 'succeeded' && observed.result) { validateBenchmarkResult(observed.result); durable.finish(benchmarkId, observed.result); return observed.result; }
      if (observed?.status === 'failed') { durable.update(benchmarkId, { status: 'failed', error: observed.error || 'benchmark_failed' }); throw new Error(observed.error || 'benchmark_failed'); }
      await sleep(pollMs);
    }
  }
  return { execute, wait, inspect: (benchmarkId) => durable?.inspect(benchmarkId) || null, get active() { return durable ? running() : local.size; } };
}
