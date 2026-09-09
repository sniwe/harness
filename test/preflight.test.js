import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeContracts } from '../src/preflight.js';
import { validateManifestCommands } from '../src/manifestExecutor.js';

test('preflight requires the exact advertised Qwen protocol plan', () => {
  const manifest = { protocolBaseline: '12.5s-primary-plus-5s-boundary-v1' }; const ready = { 'qwen-asr': { state: 'ready', body: { runtime: { audep_capabilities: { protocolVersion: 1, plans: [{ planVersion: manifest.protocolBaseline }] } } } } };
  assert.equal(validateRuntimeContracts(manifest, ready), true); assert.equal(validateRuntimeContracts(manifest, { 'qwen-asr': { ...ready['qwen-asr'], body: { runtime: { audep_capabilities: { protocolVersion: 1, plans: [{ planVersion: 'other' }] } } } } }), false); assert.equal(validateRuntimeContracts(manifest, {}), false);
});

test('manifest command validation rejects unresolved or cross-project execution', () => {
  const base = { projects: { app: { profile: 'C:\\project' } }, steps: [{ stepId: 'A0', owner: 'app' }] };
  assert.deepEqual(validateManifestCommands(base), { ok: false, missing: [{ stepId: 'A0', error: 'execution_command_missing:A0' }] });
  const mismatch = { ...base, commands: { A0: { command: 'node', args: [], cwd: 'C:\\other' } } };
  assert.deepEqual(validateManifestCommands(mismatch), { ok: false, missing: [{ stepId: 'A0', error: 'execution_cwd_mismatch:A0' }] });
  const timeout = { ...base, commands: { A0: { command: 'node', args: [], cwd: 'C:\\project', timeoutMs: 1000 } } };
  assert.deepEqual(validateManifestCommands(timeout), { ok: false, missing: [{ stepId: 'A0', error: 'execution_hard_timeout_forbidden:A0' }] });
});
