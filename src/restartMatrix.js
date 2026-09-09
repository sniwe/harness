import { runRestartTracer } from './restartTracer.js';

export const RESTART_TRACERS = Object.freeze([
  'app-during-upload',
  'app-after-seal',
  'qwen-during-asr',
  'qwen-during-constructor',
  'qwen-during-alignment',
  'app-after-partial-localization',
]);

export async function runRestartMatrix({ observe, restart, ready, sleep, pollMs, signal, record, priorEvidence = [] } = {}) {
  if (typeof observe !== 'function' || typeof restart !== 'function' || typeof ready !== 'function') throw new Error('restart_matrix_invalid');
  const evidence = [];
  for (const name of RESTART_TRACERS) {
    const prior = priorEvidence.find((item) => item?.name === name);
    if (isValidRestartEvidence(prior)) { evidence.push(prior); continue; }
    evidence.push(await runRestartTracer({
      name,
      predicate: (state) => state?.observedPredicate === name,
      observe: () => observe(name),
      restart: (before) => restart(name, before),
      ready: (state) => ready(name, state),
      sleep,
      pollMs,
      signal,
      record: (item) => record?.(item),
    }));
  }
  return evidence;
}

function isValidRestartEvidence(item) {
  return item?.verdict === 'pass' && /^[0-9a-f]{64}$/.test(item.artifactId || '') && item.trigger?.predicate === item.name && item.before?.runtimeGeneration && item.after?.runtimeGeneration && item.before?.jobId && item.after?.jobId && item.before.runtimeGeneration !== item.after.runtimeGeneration && item.before.jobId === item.after.jobId;
}
