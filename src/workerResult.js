export function requireWorkerSuccess(result) {
  if (!result || result.ok !== true || result.error || result.status === 'failed' || result.status === 'cancelled') throw new Error(result?.error || 'worker_result_failed');
  return result;
}
