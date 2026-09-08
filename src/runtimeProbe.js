export async function probeRuntime({ baseUrl, requiredPath, required = {}, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!baseUrl || !requiredPath) return { state: 'blocked', error: 'runtime_probe_config_invalid' };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}${requiredPath}`, { signal: controller.signal }); const body = await response.json().catch(() => null); if (!response.ok || !body || body.ok !== true || Object.entries(required).some(([key, value]) => keyPath(body, key) !== value)) return { state: 'blocked', error: `runtime_capability_mismatch`, status: response.status }; return { state: 'ready', status: response.status, body }; }
  catch (error) { return { state: 'blocked', error: error.name === 'AbortError' ? 'runtime_probe_timeout' : 'runtime_probe_failed' }; }
  finally { clearTimeout(timer); }
}

export async function waitForRuntime(config, { probe = probeRuntime, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs = 1000, signal } = {}) {
  while (true) {
    if (signal?.aborted) throw new Error('runtime_wait_cancelled');
    const result = await probe(config);
    if (result.state === 'ready') return result;
    await sleep(pollMs);
  }
}

function keyPath(value, key) { return key.split('.').reduce((current, part) => current?.[part], value); }
