import fs from 'node:fs';
import path from 'node:path';
import { readRunManifest } from './runManifest.js';
import { readTicketProject } from './ticketProjects.js';
import { resolveAppBenchmarkAdapter } from './appAdapter.js';
import { resolveQwenBenchmarkAdapter } from './qwenAdapter.js';
import { probeRuntime, waitForRuntime } from './runtimeProbe.js';
import { validateManifestCommands } from './manifestExecutor.js';

export function validateRuntimeContracts(manifest, runtimes) {
  const qwen = runtimes?.['qwen-asr']; const runtime = qwen?.body?.runtime; const plans = runtime?.audep_capabilities?.plans || [];
  return qwen?.state === 'ready' && runtime?.audep_capabilities?.protocolVersion === 1 && plans.some((plan) => (typeof plan === 'string' ? plan : plan?.planVersion) === manifest.protocolBaseline);
}

export async function preflightManifest(file, { projectConfig = path.resolve('config/tickets.projects.json'), waitForReady = false, signal, pollMs = 1000, sleep } = {}) {
  try {
    const manifest = readRunManifest(file);
    const projects = Object.entries(manifest.projects).map(([projectKey, value]) => {
      const project = readTicketProject(projectKey, projectConfig);
      if (value.profile !== project.root && value.root !== project.root) throw new Error(`project_root_mismatch:${projectKey}`);
      return { projectKey, root: project.root, exists: fs.existsSync(project.root) };
    });
    const missing = projects.filter((project) => !project.exists); const adapters = {};
    for (const [key, resolver] of [['main-app', resolveAppBenchmarkAdapter], ['qwen-asr', resolveQwenBenchmarkAdapter]]) { try { adapters[key] = resolver({ projectRoot: manifest.projects[key]?.profile, ...manifest.adapters?.[key] }); } catch (error) { adapters[key] = { state: 'blocked', error: error.message }; } }
    const runtimes = {}; for (const [key, runtime] of Object.entries(manifest.runtimes || {})) runtimes[key] = waitForReady ? await waitForRuntime(runtime, { signal, pollMs, ...(sleep ? { sleep } : {}) }) : await probeRuntime(runtime);
    const adapterMissing = Object.values(adapters).filter((adapter) => adapter.state === 'blocked'); const runtimeMissing = Object.values(runtimes).filter((runtime) => runtime.state === 'blocked'); const contractReady = validateRuntimeContracts(manifest, runtimes);
    const commands = validateManifestCommands(manifest);
    return { ok: missing.length === 0 && adapterMissing.length === 0 && runtimeMissing.length === 0 && contractReady && commands.ok, state: missing.length || adapterMissing.length || runtimeMissing.length || !contractReady || !commands.ok ? 'blocked' : 'ready', manifest: { runId: manifest.runId, planDigest: manifest.planDigest }, projects, missing, adapters, runtimes, contractReady, commands };
  } catch (error) { return { ok: false, state: 'blocked', error: error.message }; }
}
