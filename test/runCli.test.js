import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand } from '../src/runCli.js';

test('start refuses an unverified real manifest before creating workflow state', async () => {
  const result = await runCommand('start', 'config/runs/audep-speed.json'); assert.equal(result.ok, false); assert.equal(result.state, 'blocked'); assert.equal(result.command, 'start');
});
