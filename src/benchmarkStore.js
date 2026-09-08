import fs from 'node:fs';
import path from 'node:path';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function createBenchmarkStore(root) {
  const directory = path.join(root, 'benchmarks'); fs.mkdirSync(directory, { recursive: true });
  const fileFor = (benchmarkId) => { if (!ID.test(benchmarkId || '')) throw new Error('benchmark_id_invalid'); return path.join(directory, `${benchmarkId}.json`); };
  const write = (benchmarkId, state) => { const file = fileFor(benchmarkId); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', 'utf8'); fs.renameSync(temporary, file); return state; };
  function begin({ benchmarkId, runId, request }) { const existing = inspect(benchmarkId); if (existing) { if (existing.runId !== runId) throw new Error('benchmark_run_mismatch'); return existing; } const state = { schemaVersion: 1, benchmarkId, runId, status: 'running', request, startedAt: new Date().toISOString() }; append(benchmarkId, { type: 'benchmark_started', runId }); return write(benchmarkId, state); }
  function update(benchmarkId, patch) { const current = inspect(benchmarkId); if (!current) throw new Error('benchmark_not_found'); const next = { ...current, ...patch, updatedAt: new Date().toISOString() }; append(benchmarkId, { type: 'benchmark_updated', runId: current.runId, status: next.status }); return write(benchmarkId, next); }
  function finish(benchmarkId, result) { return update(benchmarkId, { status: result.verdict === 'pass' ? 'succeeded' : 'failed', result, finishedAt: new Date().toISOString() }); }
  function inspect(benchmarkId) { const file = fileFor(benchmarkId); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
  function list() { return fs.readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))); }
  function append(benchmarkId, event) { const file = path.join(directory, `${benchmarkId}.events.jsonl`); fs.appendFileSync(file, JSON.stringify({ eventAt: new Date().toISOString(), ...event }) + '\n', 'utf8'); }
  return { begin, update, finish, inspect, list, directory };
}
