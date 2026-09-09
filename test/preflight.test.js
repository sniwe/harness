import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProjectCheckout, inspectProjectInstructions, validateCheckoutContract, validateRuntimeContracts } from '../src/preflight.js';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import crypto from 'node:crypto';
import { validateManifestCommands } from '../src/manifestExecutor.js';

test('preflight requires the exact advertised Qwen protocol plan', () => {
  const manifest = { protocolBaseline: '12.5s-primary-plus-5s-boundary-v1' }; const ready = { 'qwen-asr': { state: 'ready', body: { runtime: { audep_capabilities: { protocolVersion: 1, plans: [{ planVersion: manifest.protocolBaseline }] } } } } };
  assert.equal(validateRuntimeContracts(manifest, ready), true); assert.equal(validateRuntimeContracts(manifest, { 'qwen-asr': { ...ready['qwen-asr'], body: { runtime: { audep_capabilities: { protocolVersion: 1, plans: [{ planVersion: 'other' }] } } } } }), false); assert.equal(validateRuntimeContracts(manifest, {}), false);
});

test('preflight reports repository instruction provenance without requiring invented files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'preflight-instructions-')); fs.writeFileSync(path.join(root, 'AGENTS.md'), 'rules'); const digest = crypto.createHash('sha256').update('rules').digest('hex');
  assert.deepEqual(inspectProjectInstructions(root), { root, files: [{ name: 'AGENTS.md', state: 'present', path: path.join(root, 'AGENTS.md'), sha256: digest }, { name: 'CONTEXT.md', state: 'not_present' }] });
});

test('preflight reports complete checkout identity and dirty inventory', () => {
  const result = inspectProjectCheckout('C:\\project', { execFileSync: (_command, args) => { const key = args.slice(2).join(' '); if (key === 'rev-parse HEAD') return '0123456789abcdef0123456789abcdef01234567\n'; if (key === 'branch --show-current') return 'main\n'; if (key === 'remote get-url origin') return 'origin\n'; if (key === 'status --porcelain') return ' M source.js\n?? generated.log\n'; throw new Error(key); } });
  assert.equal(result.state, 'observed'); assert.deepEqual(result.checkout.dirtyInventory, [' M source.js', '?? generated.log']); assert.equal(result.checkout.worktreeClean, false);
});

test('preflight rejects checkout origin or branch drift', () => {
  assert.deepEqual(validateCheckoutContract({ origin: 'https://github.com/example/app.git', branch: 'main' }, { checkout: { origin: 'https://github.com/example/other.git', branch: '' } }), [{ field: 'origin', expected: 'https://github.com/example/app.git', observed: 'https://github.com/example/other.git' }, { field: 'branch', expected: 'main', observed: null }]);
});

test('manifest command validation rejects unresolved or cross-project execution', () => {
  const base = { projects: { app: { profile: 'C:\\project' } }, steps: [{ stepId: 'A0', owner: 'app' }] };
  assert.deepEqual(validateManifestCommands(base), { ok: false, missing: [{ stepId: 'A0', error: 'execution_command_missing:A0' }] });
  const mismatch = { ...base, commands: { A0: { command: 'node', args: [], cwd: 'C:\\other' } } };
  assert.deepEqual(validateManifestCommands(mismatch), { ok: false, missing: [{ stepId: 'A0', error: 'execution_cwd_mismatch:A0' }] });
  const timeout = { ...base, commands: { A0: { command: 'node', args: [], cwd: 'C:\\project', timeoutMs: 1000 } } };
  assert.deepEqual(validateManifestCommands(timeout), { ok: false, missing: [{ stepId: 'A0', error: 'execution_hard_timeout_forbidden:A0' }] });
});
