import { preflightManifest } from './preflight.js';
import { readRunManifest } from './runManifest.js';
import { fileURLToPath } from 'node:url';
import { createWorkflow } from './workflowEngine.js';
import { runRehearsal, renderRunReport } from './rehearsal.js';
import { writeFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };

export async function runCommand(commandName, manifestFile, { store, outFile } = {}) {
  if (!manifestFile) throw new Error('manifest_required');
  if (commandName === 'validate') return readRunManifest(manifestFile) && { ok: true, command: commandName, manifest: manifestFile };
  if (commandName === 'preflight') return preflightManifest(manifestFile);
  if (commandName === 'start') { const check = await preflightManifest(manifestFile); if (!check.ok) return { ...check, command: commandName }; }
  const manifest = readRunManifest(manifestFile); const workflow = createWorkflow({ manifest, store });
  if (commandName === 'inspect') return { ok: true, state: workflow.snapshot(), next: workflow.next() };
  if (commandName === 'explain-block') return { ok: true, blocked: Object.values(workflow.snapshot().steps).filter((step) => step.status === 'blocked').map(({ stepId, blockReason }) => ({ stepId, blockReason })) };
  if (commandName === 'report') { const state = workflow.snapshot(); const report = renderRunReport({ manifest, result: { ok: state.status === 'accepted', runId: manifest.runId, state, trace: [] } }); if (outFile) writeFileSync(outFile, report + '\n', 'utf8'); return { ok: true, runId: manifest.runId, status: state.status, steps: state.steps, report, reportFile: outFile || undefined }; }
  if (commandName === 'cancel') return { ok: true, state: workflow.cancel(value('--reason') || 'operator_cancelled') };
  if (commandName === 'resume') return { ok: true, state: workflow.resume(value('--resolution')) };
  if (commandName === 'rehearse') { if (value('--fixture') !== '1') throw new Error('synthetic_rehearsal_requires_fixture'); return runRehearsal({ manifest }).then((result) => ({ ...result, report: renderRunReport({ manifest, result }) })); }
  throw new Error('run_command_invalid');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    try { const result = await runCommand(command, value('--manifest'), { outFile: value('--out') || undefined }); console.log(JSON.stringify(result)); if (result.ok === false) process.exitCode = 2; }
  catch (error) { console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 2; }
}
