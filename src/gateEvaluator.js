export function evaluateEvidence({ evidence, step, manifest }) {
  if (!evidence || evidence.runId !== manifest.runId || evidence.stepId !== step.stepId || evidence.verdict !== 'pass' || !evidence.artifactId || !evidence.verifier) return { ok: false, reason: 'evidence_missing_or_invalid' };
  if (evidence.planDigest !== manifest.planDigest) return { ok: false, reason: 'evidence_plan_digest_mismatch' };
  return { ok: true, gateId: `${step.stepId}:${step.verifierProfile}`, artifactId: evidence.artifactId, verifier: evidence.verifier };
}
