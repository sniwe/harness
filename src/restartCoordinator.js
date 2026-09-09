import { runRestartMatrix } from './restartMatrix.js';
import { isValidRestartEvidence } from './restartMatrix.js';

export function createRestartCoordinator({ store, observe, restart, ready, sleep, pollMs, signal } = {}) {
  if (!store?.events || !store?.append) throw new Error('restart_coordinator_store_invalid');
  if (typeof observe !== 'function' || typeof restart !== 'function' || typeof ready !== 'function') throw new Error('restart_coordinator_invalid');
  function history() { return store.events(); }
  function priorEvidence() { return history().filter((event) => event.type === 'restart_tracer_completed').map((event) => event.evidence).filter(Boolean); }
  function unresolvedIntent() {
    const pending = new Map();
    for (const event of history()) {
      if (event.type === 'restart_tracer_intent') pending.set(event.name, event);
      if (event.type === 'restart_tracer_completed' && isValidRestartEvidence(event.evidence)) pending.delete(event.evidence.name);
    }
    return pending.values().next().value;
  }
  async function run(options = {}) {
    const pending = unresolvedIntent();
    if (pending) throw new Error(`restart_tracer_unknown_after_restart:${pending.name}`);
    return runRestartMatrix({ ...options, observe, restart, ready, sleep, pollMs, priorEvidence: priorEvidence(), recordIntent: async (item) => store.append({ type: 'restart_tracer_intent', ...item }), record: async (item) => store.append({ type: 'restart_tracer_completed', evidence: item }) });
  }
  return { run, history, priorEvidence, unresolvedIntent };
}
