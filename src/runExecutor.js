import crypto from 'node:crypto';
import { createAttemptStore } from './attemptStore.js';
import { runCommand } from './commandRunner.js';
import { evaluateEvidence } from './gateEvaluator.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function evidenceFromCommand(step, result) {
  if (result.state !== 'succeeded') throw new Error(result.error || `step_command_${result.state}`);
  const lines = String(result.output || '').trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error('step_evidence_missing');
  let evidence;
  try { evidence = JSON.parse(lines.at(-1)); } catch { throw new Error('step_evidence_invalid_json'); }
  if (evidence.stepId !== step.stepId || evidence.verdict !== 'pass') throw new Error('step_evidence_invalid');
  return evidence;
}

export function createRunExecutor({ workflow, manifest, attemptStore, operationOutbox, commandRunner = runCommand, resolveCommand, runner, pollMs = 1000, heartbeatMs = 0, sleepImpl = sleep, skipConditional = [], autoRetry = true } = {}) {
  if (!workflow || !manifest || (!resolveCommand && !runner)) throw new Error('run_executor_invalid');
  const attempts = attemptStore || createAttemptStore(workflow.store.dir);

  async function executeStep(step) {
    const declared = manifest.steps.find((item) => item.stepId === step.stepId);
    if (!declared) throw new Error(`step_not_declared:${step.stepId}`);
    const started = workflow.begin(step.stepId);
    const attempt = attempts.begin({
      attemptId: started.steps[step.stepId].attemptId,
      runId: manifest.runId,
      planDigest: manifest.planDigest,
      stepId: step.stepId,
      operationId: crypto.randomUUID(),
      owner: step.owner,
      commandProfile: declared.commandProfile,
      immutableInputs: declared.immutableInputs,
    });
    let heartbeatTimer;
    try {
      operationOutbox?.intent(attempt.operationId, { runId: manifest.runId, stepId: step.stepId, attemptId: attempt.attemptId, action: 'execute_step' });
      workflow.heartbeat(step.stepId, { attemptId: attempt.attemptId, operationId: attempt.operationId });
      if (heartbeatMs > 0) heartbeatTimer = setInterval(() => { try { workflow.heartbeat(step.stepId, { attemptId: attempt.attemptId, operationId: attempt.operationId }); } catch { /* terminal state is durable */ } }, heartbeatMs);
      const raw = runner
        ? await runner({ manifest, step: declared, attempt })
        : evidenceFromCommand(declared, await commandRunner({ ...resolveCommand({ manifest, step: declared, attempt }), step: declared }));
      const evidence = raw?.state ? evidenceFromCommand(declared, raw) : raw;
      const gate = evaluateEvidence({ evidence, step: declared, manifest });
      if (!gate.ok) throw new Error(`evidence_${gate.reason}`);
      const outcome = attempts.finish(attempt.attemptId, { state: 'succeeded', evidence });
      operationOutbox?.result(attempt.operationId, { state: 'succeeded', attemptId: attempt.attemptId });
      workflow.accept(step.stepId, evidence);
      return outcome;
    } catch (error) {
      const blockArtifactId = crypto.createHash('sha256').update(`${attempt.attemptId}:${error.message}`).digest('hex');
      const outcome = attempts.finish(attempt.attemptId, { state: 'blocked', reason: 'execution_failed', error: error.message, artifactId: blockArtifactId });
      try { operationOutbox?.result(attempt.operationId, { state: 'blocked', attemptId: attempt.attemptId, artifactId: blockArtifactId }); } catch { /* missing intent is retained as the blocker */ }
      const state = workflow.snapshot();
      workflow.store.append({ type: 'step_execution_blocked', runId: state.runId, stepId: step.stepId, attemptId: attempt.attemptId, artifactId: blockArtifactId, error: error.message });
      workflow.store.write({ ...state, status: 'blocked', steps: { ...state.steps, [step.stepId]: { ...state.steps[step.stepId], status: 'blocked', blockReason: 'execution_failed', blockArtifactId, failureAttemptId: attempt.attemptId, failure: error.message } } });
      return outcome;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
  }

  function recover() {
    const recovered = [];
    for (const record of attempts.recover()) {
      if (record.input.runId !== manifest.runId) continue;
      const state = workflow.snapshot();
      const current = state.steps[record.input.stepId];
      if (current?.attemptId !== record.input.attemptId || !['running', 'verifying'].includes(current.status)) continue;
      if (record.outcome?.state === 'succeeded' && record.outcome.evidence) {
        try { operationOutbox?.result(record.input.operationId, { state: 'succeeded', attemptId: record.input.attemptId, recovered: true }); } catch { /* an already-closed or unavailable outbox is not replayed */ }
        workflow.accept(record.input.stepId, record.outcome.evidence);
        recovered.push(record.outcome);
        continue;
      }
      if (record.outcome?.state === 'blocked') {
        const artifactId = record.outcome.artifactId || crypto.createHash('sha256').update(`${record.input.attemptId}:${record.outcome.error || 'execution_failed'}`).digest('hex');
        try { operationOutbox?.result(record.input.operationId, { state: 'blocked', attemptId: record.input.attemptId, artifactId, recovered: true }); } catch { /* an already-closed or unavailable outbox is retained */ }
        workflow.store.append({ type: 'step_blocked_after_recovery', runId: state.runId, stepId: record.input.stepId, attemptId: record.input.attemptId, artifactId, reason: record.outcome.reason || 'execution_failed' });
        workflow.store.write({ ...state, status: 'blocked', steps: { ...state.steps, [record.input.stepId]: { ...current, status: 'blocked', blockReason: record.outcome.reason || 'execution_failed', blockArtifactId: artifactId, failureAttemptId: record.input.attemptId } } });
        recovered.push(record.outcome);
        continue;
      }
      if (record.outcome) continue;
      const outcome = attempts.finish(record.input.attemptId, { state: 'unknown', reason: 'unknown_after_crash' });
      try { operationOutbox?.result(record.input.operationId, { state: 'unknown', attemptId: record.input.attemptId, reason: 'unknown_after_crash' }); } catch { /* retain evidence if the outbox is unavailable */ }
      const refreshed = workflow.snapshot();
      workflow.store.append({ type: 'step_blocked_after_recovery', runId: refreshed.runId, stepId: record.input.stepId, attemptId: record.input.attemptId, reason: 'unknown_after_crash' });
      workflow.store.write({ ...refreshed, status: 'blocked', steps: { ...refreshed.steps, [record.input.stepId]: { ...refreshed.steps[record.input.stepId], status: 'blocked', blockReason: 'unknown_after_crash', blockAttemptId: record.input.attemptId } } });
      recovered.push(outcome);
    }
    return recovered;
  }

  async function run({ signal } = {}) {
    recover();
    while (true) {
      if (signal?.aborted) throw new Error('run_execution_cancelled');
      const state = workflow.snapshot();
      if (['accepted', 'blocked', 'cancelled'].includes(state.status)) return state;
      const step = workflow.next();
      if (step && skipConditional.includes(step.stepId)) {
        const artifactId = crypto.createHash('sha256').update(`skip:${manifest.runId}:${step.stepId}`).digest('hex');
        const declared = manifest.steps.find((item) => item.stepId === step.stepId);
        workflow.skipStep(step.stepId, { artifactId, reason: 'explicit_executor_policy', verifier: { profile: declared.verifierProfile, exitCode: 0 } });
        continue;
      }
      if (step) {
        await executeStep(step);
        const after = workflow.snapshot(); const failed = after.steps[step.stepId];
        if (autoRetry && failed?.status === 'blocked' && failed.blockReason === 'execution_failed' && (failed.correctiveAttempts || 0) < (manifest.limits?.maxCorrectiveAttemptsPerGate || 0)) workflow.retryStep(step.stepId, 'executor_corrective_attempt');
        continue;
      }
      await sleepImpl(pollMs);
    }
  }

  return { run, executeStep, recover, attempts };
}
