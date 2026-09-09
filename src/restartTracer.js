import crypto from 'node:crypto';

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function runRestartTracer({ name, predicate, observe, restart, ready, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs = 1000, signal, recordIntent = async () => {}, record = async () => {} } = {}) {
  if (!name || !predicate || !observe || !restart || !ready) throw new Error('restart_tracer_invalid');
  let before;
  while (true) {
    if (signal?.aborted) throw new Error('restart_tracer_cancelled');
    before = await observe();
    if (await predicate(before)) break;
    await sleep(pollMs);
  }
  await recordIntent({ name, state: 'restart_intent', before });
  await restart(before);
  let after;
  while (true) {
    if (signal?.aborted) throw new Error('restart_tracer_cancelled');
    after = await observe();
    if (await ready(after, before)) break;
    await sleep(pollMs);
  }
  if (!before.runtimeGeneration || !before.jobId || !after?.runtimeGeneration || !after?.jobId || before.runtimeGeneration === after.runtimeGeneration || before.jobId !== after.jobId) throw new Error('restart_tracer_identity_invalid');
  const evidence = { name, verdict: 'pass', trigger: { predicate: name }, before, after };
  const result = { ...evidence, artifactId: digest(evidence) };
  await record(result);
  return result;
}
