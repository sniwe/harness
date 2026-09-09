import { runRestartTracer } from './restartTracer.js';

export const RESTART_TRACERS = Object.freeze([
  'app-during-upload',
  'app-after-seal',
  'qwen-during-asr',
  'qwen-during-constructor',
  'qwen-during-alignment',
  'app-after-partial-localization',
]);

export async function runRestartMatrix({ observe, restart, ready, sleep, pollMs, signal, record } = {}) {
  if (typeof observe !== 'function' || typeof restart !== 'function' || typeof ready !== 'function') throw new Error('restart_matrix_invalid');
  const evidence = [];
  for (const name of RESTART_TRACERS) {
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
