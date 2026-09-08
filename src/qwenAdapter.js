import fs from 'node:fs';
import path from 'node:path';

export function resolveQwenBenchmarkAdapter({ projectRoot, python, tracer, fixtureJob } = {}) {
  if (!projectRoot || !python || !tracer) throw new Error('qwen_benchmark_adapter_invalid');
  const pythonPath = path.resolve(python); const tracerPath = path.resolve(projectRoot, tracer);
  if (!fs.existsSync(pythonPath)) throw new Error('qwen_python_missing');
  if (!fs.existsSync(tracerPath)) throw new Error('qwen_tracer_missing');
  const fixtureRoot = path.resolve(projectRoot, fixtureJob || ''); const manifestPath = path.join(fixtureRoot, 'manifest.json');
  if (!fixtureRoot || !fs.existsSync(manifestPath) || !fs.existsSync(path.join(fixtureRoot, 'chunks'))) throw new Error('qwen_fixture_missing');
  let fixture; try { fixture = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { throw new Error('qwen_fixture_invalid'); }
  if (!Number.isFinite(fixture.mediaDurationMs) || fixture.mediaDurationMs <= 0 || !fixture.sourceAudioRevision || !fixture.planVersion || !Array.isArray(fixture.planCalls) || fixture.planCalls.length === 0 || fixture.planCalls.some((call) => !fs.existsSync(path.join(fixtureRoot, 'chunks', `${String(call.index).padStart(8, '0')}.pcm.f32le`)))) throw new Error('qwen_fixture_invalid');
  return { projectRoot, python: pythonPath, tracer: tracerPath, fixtureJob: fixtureRoot, fixture: { mediaDurationMs: fixture.mediaDurationMs, sourceAudioRevision: fixture.sourceAudioRevision, planVersion: fixture.planVersion, planCalls: fixture.planCalls.length }, command: pythonPath, args: [tracerPath] };
}
