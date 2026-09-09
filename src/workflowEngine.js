import crypto from 'node:crypto';
import { evaluateEvidence } from './gateEvaluator.js';
import { reduceRun } from './phaseReducer.js';
import { createRunStore } from './runStore.js';

export function createWorkflow({ manifest, store = createRunStore({ runId: manifest.runId, manifest }), initialize = true } = {}) {
  const initial = { schemaVersion: 1, runId: manifest.runId, planDigest: manifest.planDigest, status: 'waiting_inputs', steps: {}, evidence: {} };
  if (initialize) store.initialize(reduceRun(initial, manifest), manifest);
  function snapshot() { const state = store.read(); if (state.runId !== manifest.runId || state.planDigest !== manifest.planDigest) throw new Error('run_state_manifest_mismatch'); return reduceRun(state, manifest); }
  function next() { const state = snapshot(); return state.status === 'running' ? Object.values(state.steps).find((step) => step.status === 'runnable') : undefined; }
  function begin(stepId) {
    const state = snapshot(); const step = manifest.steps.find((item) => item.stepId === stepId); const current = state.steps[stepId];
    if (state.status !== 'running' || !step || !current || current.status !== 'runnable') throw new Error(`step_not_runnable:${stepId}`);
    const nextState = { ...state, steps: { ...state.steps, [stepId]: { ...current, status: 'running', owner: step.owner, attempts: current.attempts + 1, attemptId: crypto.randomUUID(), lastHeartbeatAt: new Date().toISOString() } } };
    store.append({ type: 'step_started', runId: state.runId, stepId }); return store.write(nextState);
  }
  function heartbeat(stepId, details = {}) { const state = snapshot(); const current = state.steps[stepId]; if (!current || !['running', 'verifying'].includes(current.status)) throw new Error(`step_not_active:${stepId}`); const nextState = { ...state, steps: { ...state.steps, [stepId]: { ...current, lastHeartbeatAt: new Date().toISOString(), heartbeat: details } } }; store.append({ type: 'step_heartbeat', runId: state.runId, stepId }); return store.write(nextState); }
  function accept(stepId, evidence) {
    const state = snapshot(); const step = manifest.steps.find((item) => item.stepId === stepId); if (!step || !['running', 'verifying', 'waiting_peer'].includes(state.steps[stepId]?.status)) throw new Error(`step_not_verifying:${stepId}`); const result = evaluateEvidence({ evidence, step, manifest });
    if (!result.ok) { store.append({ type: 'step_blocked', runId: state.runId, stepId, reason: result.reason, artifactId: evidence?.artifactId }); return store.write({ ...state, steps: { ...state.steps, [stepId]: { ...state.steps[stepId], status: 'blocked', blockReason: result.reason, blockArtifactId: evidence?.artifactId } } }); }
    const nextState = reduceRun({ ...state, evidence: { ...state.evidence, [stepId]: evidence }, steps: { ...state.steps, [stepId]: { ...state.steps[stepId], status: 'succeeded', gateId: result.gateId } } }, manifest);
    store.append({ type: 'step_accepted', runId: state.runId, stepId, artifactId: evidence.artifactId, gateId: result.gateId }); return store.write(nextState);
  }
  function waitForPeer(stepId, { reason, artifactId } = {}) {
    const state = snapshot(); const step = manifest.steps.find((item) => item.stepId === stepId); const current = state.steps[stepId];
    if (!step || !current || !['running', 'verifying'].includes(current.status) || !reason) throw new Error(`step_peer_wait_invalid:${stepId}`);
    const nextState = { ...state, steps: { ...state.steps, [stepId]: { ...current, status: 'waiting_peer', peerWaitReason: reason, peerArtifactId: artifactId || undefined, peerWaitAt: new Date().toISOString() } } };
    store.append({ type: 'step_waiting_peer', runId: state.runId, stepId, reason, artifactId }); return store.write(nextState);
  }
  function skipStep(stepId, { artifactId, reason, verifier } = {}) {
    const state = snapshot(); const step = manifest.steps.find((item) => item.stepId === stepId); const current = state.steps[stepId];
    if (!step || step.optionalPolicy !== 'conditional' || current?.status !== 'runnable') throw new Error(`step_skip_denied:${stepId}`);
    if (!/^[0-9a-f]{64}$/.test(artifactId || '') || !reason || !verifier) throw new Error('skip_evidence_invalid');
    const nextState = { ...state, evidence: { ...state.evidence, [stepId]: { runId: state.runId, stepId, planDigest: state.planDigest, verdict: 'skip', outputTypes: [], artifactId, verifier, reason } }, steps: { ...state.steps, [stepId]: { ...current, status: 'skipped', skipReason: reason, skipArtifactId: artifactId, skipVerifier: verifier } } };
    store.append({ type: 'step_skipped', runId: state.runId, stepId, artifactId, reason }); return store.write(reduceRun(nextState, manifest));
  }
  function cancel(reason = 'operator_cancelled') { const state = snapshot(); const nextState = { ...state, status: 'cancelled', cancelReason: reason, cancelledAt: new Date().toISOString() }; store.append({ type: 'run_cancelled', runId: state.runId, reason }); return store.write(nextState); }
  function retryStep(stepId, reason = 'corrective_attempt') { const state = snapshot(); const current = state.steps[stepId]; const limit = manifest.limits?.maxCorrectiveAttemptsPerGate ?? 0; const correctiveAttempts = current?.correctiveAttempts ?? 0; if (!current || current.status !== 'blocked' || correctiveAttempts >= limit) throw new Error(`step_retry_denied:${stepId}`); const nextState = { ...state, status: 'running', steps: { ...state.steps, [stepId]: { ...current, status: 'runnable', correctiveAttempts: correctiveAttempts + 1, retryReason: reason } } }; store.append({ type: 'step_retried', runId: state.runId, stepId, reason }); return store.write(nextState); }
  function resume(resolution) { const state = snapshot(); const step = Object.values(state.steps).find((item) => item.status === 'blocked' && item.blockArtifactId === resolution); if (!step) throw new Error('resolution_not_found'); return retryStep(step.stepId, `resolution:${resolution}`); }
  return { snapshot, next, begin, heartbeat, accept, waitForPeer, skipStep, cancel, retryStep, resume, store };
}
