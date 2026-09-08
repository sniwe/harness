import crypto from 'node:crypto';

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function runRestartTracer({ name, predicate, observe, restart, ready, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs = 1000, signal, record = async () => {} } = {}) {
  if (!name || !predicate || !observe || !restart || !ready) throw new Error('restart_tracer_invalid');
  let before;
  while (true) {
    if (signal?.aborted) throw new Error('restart_tracer_cancelled');
    before = await observe();
    if (await predicate(before)) break;
    await sleep(pollMs);
  }
  await restart(before);
  let after;
  while (true) {
    if (signal?.aborted) throw new Error('restart_tracer_cancelled');
    after = await observe();
    if (await ready(after, before)) break;
    await sleep(pollMs);
  }
  const evidence = { name, verdict: 'pass', trigger: { predicate: name }, before: { runtimeGeneration: before.runtimeGeneration, jobId: before.jobId }, after: { runtimeGeneration: after.runtimeGeneration, jobId: after.jobId } };
  const result = { ...evidence, artifactId: digest(evidence) };
  await record(result);
  return result;
}
