export function reduceRun(state, manifest) {
  const evidence = state.evidence || {};
  const steps = manifest.steps.map((step) => {
    const current = state.steps?.[step.stepId] || { status: 'queued', attempts: 0 };
    const dependenciesReady = step.dependsOn.every((id) => state.steps?.[id]?.status === 'succeeded');
    if (['running', 'verifying', 'retry_wait', 'succeeded', 'blocked', 'failed', 'cancelled'].includes(current.status)) return { ...current, stepId: step.stepId };
    if (!dependenciesReady) return { ...current, stepId: step.stepId, status: 'waiting_inputs' };
    return { ...current, stepId: step.stepId, status: current.status === 'verifying' ? 'verifying' : 'runnable' };
  });
  return { ...state, steps: Object.fromEntries(steps.map((step) => [step.stepId, step])), status: steps.some((step) => step.status === 'blocked' || step.status === 'failed') ? 'blocked' : steps.every((step) => step.status === 'succeeded') ? 'accepted' : 'running' };
}
