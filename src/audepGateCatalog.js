export const AUDEP_GATES = Object.freeze({
  A1: 'a1-byte-hash-equivalence', A2A: 'a2a-before-seal-partial', A2B: 'a2b-long-poll-adoption', A3: 'a3-concurrency-comparison', A4: 'a4-normal-browser', A5: 'a5-persistence-disposition', A6: 'a6-adaptive-v2-acceptance', A7: 'a7-final-cross-machine-acceptance', Q0: 'q0-987-baseline', Q1: 'q1-long-poll-contract', Q2: 'q2-987-slow-constructor', Q3: 'q3-late-correction', Q4: 'q4-quality-vram-freeze', Q5: 'q5-complete-localization', Q6: 'q6-boundary-contract', Q7: 'q7-release-candidate'
});

export function gateFor(stepId) { const gate = AUDEP_GATES[stepId]; if (!gate) throw new Error(`audep_gate_unknown:${stepId}`); return gate; }

export function validateGateEvidence({ step, evidence } = {}) {
  const gateId = gateFor(step?.stepId);
  if (evidence?.gateId && evidence.gateId !== gateId) return { ok: false, reason: 'evidence_gate_mismatch' };
  if (evidence?.verifier?.profile !== step.verifierProfile) return { ok: false, reason: 'evidence_verifier_profile_mismatch', gateId };
  return { ok: true, gateId };
}
