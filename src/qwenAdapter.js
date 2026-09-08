import fs from 'node:fs';
import path from 'node:path';

export function resolveQwenBenchmarkAdapter({ projectRoot, python, tracer } = {}) {
  if (!projectRoot || !python || !tracer) throw new Error('qwen_benchmark_adapter_invalid');
  const pythonPath = path.resolve(python); const tracerPath = path.resolve(projectRoot, tracer);
  if (!fs.existsSync(pythonPath)) throw new Error('qwen_python_missing');
  if (!fs.existsSync(tracerPath)) throw new Error('qwen_tracer_missing');
  return { projectRoot, python: pythonPath, tracer: tracerPath, command: pythonPath, args: [tracerPath] };
}
