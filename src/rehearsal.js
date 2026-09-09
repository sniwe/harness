import crypto from 'node:crypto';
import { createWorkflow } from './workflowEngine.js';
import { recordFinalAcceptance } from './finalAcceptance.js';

const RESTART_TRACERS = Object.freeze(['app-during-upload', 'app-after-seal', 'qwen-during-asr', 'qwen-during-constructor', 'qwen-during-alignment', 'app-after-partial-localization']);

export async function runRehearsal({ manifest, store, runner = async ({ step }) => { const declared = manifest.steps.find((item) => item.stepId === step.stepId); return { runId: manifest.runId, stepId: step.stepId, planDigest: manifest.planDigest, verdict: 'pass', outputTypes: declared.requiredOutputTypes, artifactId: crypto.createHash('sha256').update(step.stepId).digest('hex'), verifier: { profile: declared.verifierProfile, exitCode: 0 } }; }, skipSteps = [], retrySteps = {}, restartAfterStep = false, acceptanceEvidence, restartCoordinator } = {}) {
  let workflow = createWorkflow({ manifest, store }); const trace = []; const skips = new Set(skipSteps); const retries = new Map(Object.entries(retrySteps));
  while (true) { const step = workflow.next(); if (!step) break;
    if (skips.has(step.stepId)) { const artifactId = crypto.createHash('sha256').update(`skip:${manifest.runId}:${step.stepId}`).digest('hex'); workflow.skipStep(step.stepId, { artifactId, reason: 'rehearsal_optional_disposition', verifier: { profile: step.verifierProfile, exitCode: 0 } }); trace.push({ stepId: step.stepId, state: 'skipped' }); if (restartAfterStep) workflow = createWorkflow({ manifest, store, initialize: false }); continue; }
    workflow.begin(step.stepId); trace.push({ stepId: step.stepId, state: 'running' }); let evidence; try { evidence = await runner({ step, workflow }); } catch (error) { const declared = manifest.steps.find((item) => item.stepId === step.stepId); evidence = { runId: manifest.runId, stepId: step.stepId, planDigest: manifest.planDigest, verdict: 'fail', outputTypes: declared.requiredOutputTypes, artifactId: crypto.createHash('sha256').update(`${step.stepId}:${error.message}`).digest('hex'), verifier: { profile: declared.verifierProfile, error: error.message } }; }
    const state = workflow.accept(step.stepId, evidence); trace.push({ stepId: step.stepId, state: state.steps[step.stepId].status });
    if (state.steps[step.stepId].status === 'blocked' && Number(retries.get(step.stepId) || 0) > 0) { retries.set(step.stepId, Number(retries.get(step.stepId)) - 1); workflow.retryStep(step.stepId, 'rehearsal_corrective_attempt'); trace.push({ stepId: step.stepId, state: 'retry_wait' }); }
    if (restartAfterStep) workflow = createWorkflow({ manifest, store, initialize: false });
  }
  const state = workflow.snapshot(); const restarts = restartCoordinator ? await restartCoordinator.run() : []; const finalAcceptance = acceptanceEvidence ? recordFinalAcceptance({ store, ...acceptanceEvidence, restarts }) : undefined;
  return { ok: state.status === 'accepted' && (!finalAcceptance || finalAcceptance.ok), runId: manifest.runId, trace, state, restarts, finalAcceptance };
}

export function renderRunReport({ manifest, result }) {
  const lines = [`# Run report: ${result.runId}`, '', `- Verdict: **${result.ok ? 'PASS' : 'BLOCKED'}**`, `- Plan digest: \`${manifest.planDigest}\``, `- Workflow status: \`${result.state.status}\``, '', '## Runtime and configuration', ''];
  for (const [projectKey, project] of Object.entries(manifest.projects || {})) lines.push(`- ${projectKey}: machine \`${project.machineKey}\`; profile \`${project.profile}\``);
  for (const [projectKey, runtime] of Object.entries(manifest.runtimes || {})) lines.push(`- ${projectKey} runtime: \`${runtime.baseUrl}${runtime.requiredPath}\`; required capabilities ${Object.keys(runtime.required || {}).join(', ') || 'none'}`);
  lines.push('', '## Steps', '');
  for (const step of Object.values(result.state.steps)) { const manifestStep = manifest.steps.find((item) => item.stepId === step.stepId); const waiting = manifestStep?.dependsOn?.filter((id) => !['succeeded', 'skipped'].includes(result.state.steps[id]?.status)) || []; lines.push(`- ${step.stepId}: ${step.status}${step.gateId ? ` (${step.gateId})` : ''}${step.owner ? `; owner ${step.owner}` : ''}${step.lastHeartbeatAt ? `; heartbeat ${step.lastHeartbeatAt}` : ''}${waiting.length ? `; waiting on ${waiting.join(', ')}` : ''}`); }
  lines.push('', '## Evidence index', ''); const evidence = result.state.evidence || {}; const evidenceEntries = Object.entries(evidence); if (!evidenceEntries.length) lines.push('- none retained'); else for (const [stepId, item] of evidenceEntries) lines.push(`- ${stepId}: artifact \`${item.artifactId || 'missing'}\`, verdict \`${item.verdict || 'unknown'}\``);
  lines.push('', '## Restart matrix', ''); const restarts = new Map((result.restarts || []).map((item) => [item.name, item])); for (const name of RESTART_TRACERS) { const item = restarts.get(name); lines.push(`- ${name}: ${item?.verdict || 'not_observed'}${item?.artifactId ? `; artifact \`${item.artifactId}\`` : ''}${item?.trigger?.predicate ? `; predicate \`${item.trigger.predicate}\`` : ''}`); }
  if (result.finalAcceptance) { lines.push('', '## Final acceptance', '', `- Verdict: **${result.finalAcceptance.ok ? 'PASS' : String(result.finalAcceptance.verdict || 'BLOCKED').toUpperCase()}**`); if (result.finalAcceptance.reason) lines.push(`- Reason: \`${result.finalAcceptance.reason}\``); if (result.finalAcceptance.missing?.length) lines.push(`- Missing restart evidence: ${result.finalAcceptance.missing.join(', ')}`); }
  else lines.push('', '## Final acceptance', '', '- Verdict: **NOT_EVALUATED**', '- Bilateral app/Qwen acceptance evidence was not supplied.');
  lines.push('', '## Trace', '', '```json', JSON.stringify(result.trace, null, 2), '```', ''); return lines.join('\n');
}
