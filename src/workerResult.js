export function requireWorkerSuccess(result, { expectedCwd, expectedProjectKey } = {}) {
  const nested = result?.result || result?.turn || result?.params?.turn || result?.params;
  if (!result || result.ok !== true || result.error || ['failed', 'cancelled', 'error'].includes(result.status) || ['failed', 'cancelled', 'error'].includes(nested?.status) || ['failed', 'cancelled', 'error'].includes(nested?.turn?.status) || nested?.error || nested?.turn?.error) throw new Error(result?.error || nested?.error || nested?.turn?.error || 'worker_result_failed');
  if (expectedCwd && result.execution?.cwd !== expectedCwd) throw new Error('worker_execution_cwd_mismatch');
  if (expectedProjectKey && result.execution?.projectKey !== expectedProjectKey) throw new Error('worker_execution_project_mismatch');
  if (expectedCwd && (!result.execution?.threadId || !result.execution?.turnId || !result.execution?.runtimeGeneration)) throw new Error('worker_execution_identity_missing');
  return result;
}
