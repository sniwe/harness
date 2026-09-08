import { preflightManifest } from './preflight.js';
import { readRunManifest } from './runManifest.js';
import { fileURLToPath } from 'node:url';

const [command, ...args] = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : ''; };

export function runCommand(commandName, manifestFile) {
  if (!manifestFile) throw new Error('manifest_required');
  if (commandName === 'validate') return readRunManifest(manifestFile) && { ok: true, command: commandName, manifest: manifestFile };
  if (commandName === 'preflight') return preflightManifest(manifestFile);
  throw new Error('run_command_invalid');
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try { const result = runCommand(command, value('--manifest')); console.log(JSON.stringify(result)); if (result.ok === false) process.exitCode = 2; }
  catch (error) { console.log(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 2; }
}
