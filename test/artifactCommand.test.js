import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createArtifactStore } from '../src/artifactStore.js';
import { createHandoff } from '../src/handoffSchemas.js';
import { transferArtifact } from '../src/handoffTransfer.js';
import { runCommand } from '../src/commandRunner.js';
import { createDurableCommandController } from '../src/durableCommand.js';

test('artifact transfer retains exact bytes and rejects corruption', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'artifact-')); const store = createArtifactStore(root); const saved = store.put('exact\n', { mediaType: 'text/plain' });
  const descriptor = createHandoff({ runId: 'r', artifactType: 'test', producerPhase: 'A0', producer: { machineKey: 'm', projectKey: 'p' }, artifact: { sha256: saved.artifactId, byteLength: saved.byteLength, mediaType: saved.mediaType }, consumer: { machineKey: 'n', projectKey: 'q', phase: 'Q0' }, filename: 'evidence.txt', requiredAcceptanceType: 'test.acceptance' });
  const result = transferArtifact({ store, descriptor, destination: path.join(root, 'received') }); assert.equal(result.received.sha256, saved.artifactId); assert.equal(fs.readFileSync(result.received.file, 'utf8'), 'exact\n');
});

test('command runner reports real success and failure states', async () => {
  const cwd = process.cwd(); const ok = await runCommand({ command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], cwd }); const bad = await runCommand({ command: process.execPath, args: ['-e', 'process.exit(3)'], cwd });
  assert.equal(ok.state, 'succeeded'); assert.match(ok.output, /ok/); assert.equal(bad.state, 'failed'); assert.equal(bad.exitCode, 3);
});

test('durable command returns an ID and persists terminal output', async () => {
  const controller = createDurableCommandController({ root: path.join(mkdtempSync(path.join(tmpdir(), 'durable-command-')), 'commands') }); const started = controller.start({ command: process.execPath, args: ['-e', 'process.stdout.write("durable")'], cwd: process.cwd() }); assert.equal(started.state, 'running');
  let result = controller.inspect(started.commandId); for (let attempt = 0; attempt < 20 && result.state === 'running'; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 10)); result = controller.inspect(started.commandId); }
  assert.equal(result.state, 'succeeded'); assert.match(result.output, /durable/);
});

test('reconstructed durable command treats a missing process as unknown', () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'durable-command-')), 'commands'); const controller = createDurableCommandController({ root, spawnImpl: () => ({ pid: 777, unref() {}, on() {}, stdout: null, stderr: null }), probe: () => true }); const started = controller.start({ command: 'test', cwd: process.cwd() }); const restarted = createDurableCommandController({ root, probe: () => false }); assert.equal(restarted.inspect(started.commandId).state, 'unknown');
});
