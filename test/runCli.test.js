import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { resolveManifestFile, runCommand } from '../src/runCli.js';
import { createRunStore } from '../src/runStore.js';

test('start refuses an unverified real manifest before creating workflow state', async () => {
  const result = await runCommand('start', 'config/runs/audep-speed.json'); assert.equal(result.ok, false); assert.equal(result.state, 'blocked'); assert.equal(result.command, 'start');
});

test('report is read-only and does not create a missing run', async () => {
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-report-')), runId: 'audep-speed-260908' });
  await assert.rejects(() => runCommand('report', 'config/runs/audep-speed.json', { store }), /ENOENT/);
});

test('run ID resolves to exactly one configured manifest', () => {
  assert.equal(resolveManifestFile({ runId: 'audep-speed-260908' }), path.join('config', 'runs', 'audep-speed.json'));
  assert.throws(() => resolveManifestFile({ runId: 'missing-run' }), /run_id_not_found/);
});

test('start initializes a workflow after successful preflight', async () => {
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-start-')), runId: 'audep-speed-260908' }); const result = await runCommand('start', 'config/runs/audep-speed.json', { store, preflight: async () => ({ ok: true, state: 'ready' }) }); assert.equal(result.ok, true); assert.equal(result.command, 'start'); assert.equal(result.state.status, 'running'); assert.equal(result.next.stepId, 'A0');
});
