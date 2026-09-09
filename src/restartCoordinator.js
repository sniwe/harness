import { runRestartMatrix } from './restartMatrix.js';

export function createRestartCoordinator({ store, observe, restart, ready, sleep, pollMs, signal } = {}) {
  if (!store?.events || !store?.append) throw new Error('restart_coordinator_store_invalid');
  if (typeof observe !== 'function' || typeof restart !== 'function' || typeof ready !== 'function') throw new Error('restart_coordinator_invalid');
  function history() { return store.events(); }
  function priorEvidence() { return history().filter((event) => event.type === 'restart_tracer_completed').map((event) => event.evidence).filter(Boolean); }
  function unresolvedIntent() {
    const completed = new Set(priorEvidence().map((item) => item.name));
    return history().find((event) => event.type === 'restart_tracer_intent' && !completed.has(event.name));
  }
  async function run(options = {}) {
    const pending = unresolvedIntent();
    if (pending) throw new Error(`restart_tracer_unknown_after_restart:${pending.name}`);
    return runRestartMatrix({ ...options, observe, restart, ready, sleep, pollMs, priorEvidence: priorEvidence(), recordIntent: async (item) => store.append({ type: 'restart_tracer_intent', ...item }), record: async (item) => store.append({ type: 'restart_tracer_completed', evidence: item }) });
  }
  return { run, history, priorEvidence, unresolvedIntent };
}
