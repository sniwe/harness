import crypto from 'node:crypto';
import { createWorkflow } from './workflowEngine.js';

export async function runRehearsal({ manifest, store, runner = async ({ step }) => { const declared = manifest.steps.find((item) => item.stepId === step.stepId); return { runId: manifest.runId, stepId: step.stepId, planDigest: manifest.planDigest, verdict: 'pass', outputTypes: declared.requiredOutputTypes, artifactId: crypto.createHash('sha256').update(step.stepId).digest('hex'), verifier: { profile: declared.verifierProfile, exitCode: 0 } }; } } = {}) {
  const workflow = createWorkflow({ manifest, store }); const trace = [];
  while (workflow.next()) { const step = workflow.next(); workflow.begin(step.stepId); trace.push({ stepId: step.stepId, state: 'running' }); let evidence; try { evidence = await runner({ step, workflow }); } catch (error) { const declared = manifest.steps.find((item) => item.stepId === step.stepId); evidence = { runId: manifest.runId, stepId: step.stepId, planDigest: manifest.planDigest, verdict: 'fail', outputTypes: declared.requiredOutputTypes, artifactId: crypto.createHash('sha256').update(`${step.stepId}:${error.message}`).digest('hex'), verifier: { profile: declared.verifierProfile, error: error.message } }; } workflow.accept(step.stepId, evidence); trace.push({ stepId: step.stepId, state: workflow.snapshot().steps[step.stepId].status }); }
  return { ok: workflow.snapshot().status === 'accepted', runId: manifest.runId, trace, state: workflow.snapshot() };
}

export function renderRunReport({ manifest, result }) {
  const lines = [`# Run report: ${result.runId}`, '', `- Verdict: **${result.ok ? 'PASS' : 'BLOCKED'}**`, `- Plan digest: \`${manifest.planDigest}\``, `- Workflow status: \`${result.state.status}\``, '', '## Steps', ''];
  for (const step of Object.values(result.state.steps)) { const manifestStep = manifest.steps.find((item) => item.stepId === step.stepId); const waiting = manifestStep?.dependsOn?.filter((id) => !['succeeded', 'skipped'].includes(result.state.steps[id]?.status)) || []; lines.push(`- ${step.stepId}: ${step.status}${step.gateId ? ` (${step.gateId})` : ''}${step.owner ? `; owner ${step.owner}` : ''}${step.lastHeartbeatAt ? `; heartbeat ${step.lastHeartbeatAt}` : ''}${waiting.length ? `; waiting on ${waiting.join(', ')}` : ''}`); }
  lines.push('', '## Evidence index', ''); const evidence = result.state.evidence || {}; const evidenceEntries = Object.entries(evidence); if (!evidenceEntries.length) lines.push('- none retained'); else for (const [stepId, item] of evidenceEntries) lines.push(`- ${stepId}: artifact \`${item.artifactId || 'missing'}\`, verdict \`${item.verdict || 'unknown'}\``);
  lines.push('', '## Trace', '', '```json', JSON.stringify(result.trace, null, 2), '```', ''); return lines.join('\n');
}
