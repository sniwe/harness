import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runCommand } from '../src/runCli.js';
import { createRunStore } from '../src/runStore.js';

test('start refuses an unverified real manifest before creating workflow state', async () => {
  const result = await runCommand('start', 'config/runs/audep-speed.json'); assert.equal(result.ok, false); assert.equal(result.state, 'blocked'); assert.equal(result.command, 'start');
});

test('report is read-only and does not create a missing run', async () => {
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-report-')), runId: 'audep-speed-260908' });
  await assert.rejects(() => runCommand('report', 'config/runs/audep-speed.json', { store }), /ENOENT/);
});
