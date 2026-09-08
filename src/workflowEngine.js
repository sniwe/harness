import crypto from 'node:crypto';
import { evaluateEvidence } from './gateEvaluator.js';
import { reduceRun } from './phaseReducer.js';
import { createRunStore } from './runStore.js';

export function createWorkflow({ manifest, store = createRunStore({ runId: manifest.runId }) } = {}) {
  const initial = { schemaVersion: 1, runId: manifest.runId, planDigest: manifest.planDigest, status: 'waiting_inputs', steps: {}, evidence: {} };
  store.initialize(reduceRun(initial, manifest));
  function snapshot() { return reduceRun(store.read(), manifest); }
  function next() { const state = snapshot(); return state.status === 'running' ? Object.values(state.steps).find((step) => step.status === 'runnable') : undefined; }
  function begin(stepId) {
    const state = snapshot(); const step = manifest.steps.find((item) => item.stepId === stepId); const current = state.steps[stepId];
    if (state.status !== 'running' || !step || !current || current.status !== 'runnable') throw new Error(`step_not_runnable:${stepId}`);
    const nextState = { ...state, steps: { ...state.steps, [stepId]: { ...current, status: 'running', attempts: current.attempts + 1, attemptId: crypto.randomUUID() } } };
    store.append({ type: 'step_started', runId: state.runId, stepId }); return store.write(nextState);
  }
  function accept(stepId, evidence) {
    const state = snapshot(); const step = manifest.steps.find((item) => item.stepId === stepId); if (!step || !['running', 'verifying'].includes(state.steps[stepId]?.status)) throw new Error(`step_not_verifying:${stepId}`); const result = evaluateEvidence({ evidence, step, manifest });
    if (!result.ok) { store.append({ type: 'step_blocked', runId: state.runId, stepId, reason: result.reason }); return store.write({ ...state, steps: { ...state.steps, [stepId]: { ...state.steps[stepId], status: 'blocked', blockReason: result.reason } } }); }
    const nextState = reduceRun({ ...state, evidence: { ...state.evidence, [stepId]: evidence }, steps: { ...state.steps, [stepId]: { ...state.steps[stepId], status: 'succeeded', gateId: result.gateId } } }, manifest);
    store.append({ type: 'step_accepted', runId: state.runId, stepId, artifactId: evidence.artifactId, gateId: result.gateId }); return store.write(nextState);
  }
  function cancel(reason = 'operator_cancelled') { const state = snapshot(); const nextState = { ...state, status: 'cancelled', cancelReason: reason, cancelledAt: new Date().toISOString() }; store.append({ type: 'run_cancelled', runId: state.runId, reason }); return store.write(nextState); }
  function retryStep(stepId, reason = 'corrective_attempt') { const state = snapshot(); const current = state.steps[stepId]; const limit = manifest.limits?.maxCorrectiveAttemptsPerGate ?? 0; const correctiveAttempts = current?.correctiveAttempts ?? 0; if (!current || current.status !== 'blocked' || correctiveAttempts >= limit) throw new Error(`step_retry_denied:${stepId}`); const nextState = { ...state, status: 'running', steps: { ...state.steps, [stepId]: { ...current, status: 'runnable', correctiveAttempts: correctiveAttempts + 1, retryReason: reason } } }; store.append({ type: 'step_retried', runId: state.runId, stepId, reason }); return store.write(nextState); }
  return { snapshot, next, begin, accept, cancel, retryStep, store };
}
