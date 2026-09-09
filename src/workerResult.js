export function requireWorkerSuccess(result) {
  const nested = result?.result || result?.turn || result?.params?.turn || result?.params;
  if (!result || result.ok !== true || result.error || ['failed', 'cancelled', 'error'].includes(result.status) || ['failed', 'cancelled', 'error'].includes(nested?.status) || ['failed', 'cancelled', 'error'].includes(nested?.turn?.status) || nested?.error || nested?.turn?.error) throw new Error(result?.error || nested?.error || nested?.turn?.error || 'worker_result_failed');
  return result;
}
