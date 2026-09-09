import { preflightManifest } from './preflight.js';
import { readRunManifest } from './runManifest.js';
import { fileURLToPath } from 'node:url';
import { createWorkflow } from './workflowEngine.js';
import { runRehearsal, renderRunReport } from './rehearsal.js';
import { evaluateFinalAcceptance } from './finalAcceptance.js';
import { createManifestExecutor } from './manifestExecutor.js';
import { createDurableCommandController } from './durableCommand.js';
import { writeFileSync } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [command, ...args] = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };

export function resolveManifestFile({ manifestFile, runId, directory = 'config/runs' } = {}) {
  if (manifestFile) return manifestFile;
  if (!runId) return '';
  const matches = readdirSync(directory).filter((file) => file.toLowerCase().endsWith('.json')).filter((file) => { try { return JSON.parse(readFileSync(path.join(directory, file), 'utf8')).runId === runId; } catch { return false; } });
  if (matches.length !== 1) throw new Error(matches.length ? 'run_id_ambiguous' : 'run_id_not_found');
  return path.join(directory, matches[0]);
}

export async function runCommand(commandName, manifestFile, { store, outFile, acceptanceFile, fixture = false, execute = false, executorFactory, signal, preflight = preflightManifest } = {}) {
  if (!manifestFile) throw new Error('manifest_required');
  if (commandName === 'validate') return readRunManifest(manifestFile) && { ok: true, command: commandName, manifest: manifestFile };
  if (commandName === 'preflight') return preflight(manifestFile);
  if (commandName === 'start') { const check = await preflight(manifestFile, { waitForReady: true, signal }); if (!check.ok) return { ...check, command: commandName }; }
  const manifest = readRunManifest(manifestFile); const readOnly = ['inspect', 'explain-block', 'report', 'resume'].includes(commandName); const workflow = createWorkflow({ manifest, store, initialize: !readOnly });
  if (commandName === 'start') {
    if (!execute) return { ok: true, command: commandName, state: workflow.snapshot(), next: workflow.next() };
    const executor = typeof executorFactory === 'function' ? executorFactory({ manifest, workflow }) : createManifestExecutor({ manifest, workflow, durableCommandController: createDurableCommandController({ root: path.join(workflow.store.dir, 'commands') }) });
    if (!executor?.run) throw new Error('run_executor_invalid');
    return { ok: true, command: commandName, state: await executor.run({ signal }) };
  }
  if (commandName === 'inspect') return { ok: true, state: workflow.snapshot(), next: workflow.next() };
  if (commandName === 'explain-block') return { ok: true, blocked: Object.values(workflow.snapshot().steps).filter((step) => step.status === 'blocked').map(({ stepId, blockReason }) => ({ stepId, blockReason })) };
  if (commandName === 'report') { const state = workflow.snapshot(); const acceptancePath = acceptanceFile || value('--acceptance'); const finalAcceptance = acceptancePath ? evaluateFinalAcceptance(JSON.parse(readFileSync(acceptancePath, 'utf8'))) : undefined; const result = { ok: state.status === 'accepted' && Boolean(finalAcceptance?.ok), runId: manifest.runId, state, trace: workflow.store.events(), finalAcceptance }; const report = renderRunReport({ manifest, result }); if (outFile) writeFileSync(outFile, report + '\n', 'utf8'); return { ok: result.ok, runId: manifest.runId, status: state.status, steps: state.steps, finalAcceptance, report, reportFile: outFile || undefined }; }
  if (commandName === 'cancel') return { ok: true, state: workflow.cancel(value('--reason') || 'operator_cancelled') };
  if (commandName === 'resume') return { ok: true, state: workflow.resume(value('--resolution')) };
  if (commandName === 'rehearse') { if (value('--fixture') !== '1' && fixture !== true) throw new Error('synthetic_rehearsal_requires_fixture'); return runRehearsal({ manifest, store }).then((result) => { const report = renderRunReport({ manifest, result }); const file = outFile || value('--out'); if (file) writeFileSync(file, report + '\n', 'utf8'); return { ...result, report, reportFile: file || undefined }; }); }
  throw new Error('run_command_invalid');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    try { const result = await runCommand(command, resolveManifestFile({ manifestFile: value('--manifest'), runId: value('--run') }), { outFile: value('--out') || undefined, execute: args.includes('--execute') }); console.log(JSON.stringify(result)); if (result.ok === false) process.exitCode = 2; }
  catch (error) { console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 2; }
}
