import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createArtifactStore } from '../src/artifactStore.js';
import { createHandoff } from '../src/handoffSchemas.js';
import { transferArtifact } from '../src/handoffTransfer.js';
import { createArtifactTransferHandler, transferArtifactRemote, validateArtifactChunk } from '../src/artifactTransfer.js';
import { runCommand } from '../src/commandRunner.js';
import { createDurableCommandController } from '../src/durableCommand.js';

test('artifact transfer retains exact bytes and rejects corruption', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'artifact-')); const store = createArtifactStore(root); const saved = store.put('exact\n', { mediaType: 'text/plain' });
  const descriptor = createHandoff({ runId: 'r', artifactType: 'test', producerPhase: 'A0', producer: { machineKey: 'm', projectKey: 'p', commit: 'c'.repeat(40), runtimeGeneration: 'g1' }, artifact: { sha256: saved.artifactId, byteLength: saved.byteLength, mediaType: saved.mediaType }, consumer: { machineKey: 'n', projectKey: 'q', phase: 'Q0' }, filename: 'evidence.txt', requiredAcceptanceType: 'test.acceptance' });
  const result = transferArtifact({ store, descriptor, destination: path.join(root, 'received') }); assert.equal(result.received.sha256, saved.artifactId); assert.equal(fs.readFileSync(result.received.file, 'utf8'), 'exact\n');
});

test('artifact chunk transfer resumes from durable offset and publishes immutable bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'artifact-remote-'));
  const handler = createArtifactTransferHandler({ root, targetKey: 'peer' });
  const transferId = crypto.randomUUID();
  const bytes = Buffer.from('第一段\nsecond\n', 'utf8');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const chunk = (offset, value, final) => handler.handle({ transferId, targetKey: 'peer', sha256, totalLength: bytes.length, offset, chunkBase64: value.toString('base64'), final, filename: 'evidence.md' });
  assert.equal(chunk(0, bytes.subarray(0, 5), false).body.nextOffset, 5);
  const rebuilt = createArtifactTransferHandler({ root, targetKey: 'peer' });
  assert.equal(rebuilt.handle({ transferId, targetKey: 'peer', sha256, totalLength: bytes.length, offset: 0, chunkBase64: 'AA==', final: false, filename: 'evidence.md' }).body.nextOffset, 5);
  const result = chunk(5, bytes.subarray(5), true);
  assert.equal(result.body.state, 'completed');
  assert.deepEqual(fs.readFileSync(path.join(root, 'received', 'evidence.md')), bytes);
  assert.throws(() => validateArtifactChunk({ transferId, targetKey: 'wrong', sha256, totalLength: bytes.length, offset: 0, chunkBase64: '', final: false }), /artifact_target_invalid/);
  assert.equal(handler.handle({ transferId: crypto.randomUUID(), targetKey: 'peer', sha256, totalLength: bytes.length, offset: 0, chunkBase64: '', final: false, filename: '../escape.md' }).status, 400);
});

test('artifact sender resolves the peer for each chunk and preserves transfer identity', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'artifact-sender-')); const store = createArtifactStore(root); const bytes = Buffer.from('remote evidence', 'utf8'); const saved = store.put(bytes, { mediaType: 'text/plain' });
  const descriptor = createHandoff({ runId: 'r', artifactType: 'test', producerPhase: 'A0', producer: { machineKey: 'm', projectKey: 'p', commit: 'c'.repeat(40), runtimeGeneration: 'g1' }, artifact: { sha256: saved.artifactId, byteLength: saved.byteLength, mediaType: saved.mediaType }, consumer: { machineKey: 'peer', projectKey: 'q', phase: 'Q0' }, filename: 'remote.txt', requiredAcceptanceType: 'test.acceptance' });
  const receiver = createArtifactTransferHandler({ root: path.join(root, 'receiver'), targetKey: 'peer' }); let lookups = 0; let requests = [];
  const result = await transferArtifactRemote({ peerPing: { lookup: async () => { lookups += 1; return { tunnelKey: 'peer', tunnelUrl: 'https://peer.test' }; } }, peerKey: 'peer', descriptor, store, chunkBytes: 4, fetchImpl: async (_url, init) => { const payload = JSON.parse(init.body); requests.push(payload); const response = receiver.handle(payload); return { ok: response.status < 300, status: response.status, json: async () => response.body }; } });
  assert.equal(result.received.state, 'completed'); assert.equal(lookups, requests.length); assert.ok(requests.length > 1); assert.equal(new Set(requests.map((item) => item.transferId)).size, 1); assert.deepEqual(fs.readFileSync(path.join(root, 'receiver', 'received', 'remote.txt')), bytes);
});

test('command runner reports real success and failure states', async () => {
  const cwd = process.cwd(); const ok = await runCommand({ command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], cwd }); const bad = await runCommand({ command: process.execPath, args: ['-e', 'process.exit(3)'], cwd });
  assert.equal(ok.state, 'succeeded'); assert.match(ok.output, /ok/); assert.equal(bad.state, 'failed'); assert.equal(bad.exitCode, 3);
});

test('durable command returns an ID and persists terminal output', async () => {
  const controller = createDurableCommandController({ root: path.join(mkdtempSync(path.join(tmpdir(), 'durable-command-')), 'commands') }); const started = controller.start({ command: process.execPath, args: ['-e', 'process.stdout.write("durable")'], cwd: process.cwd() }); assert.equal(started.state, 'running');
  const result = await controller.wait(started.commandId, { pollMs: 10 });
  assert.equal(result.state, 'succeeded'); assert.match(result.output, /durable/); assert.equal(fs.readFileSync(result.outputFile, 'utf8'), 'durable');
});

test('reconstructed durable command treats a missing process as unknown', () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'durable-command-')), 'commands'); const controller = createDurableCommandController({ root, spawnImpl: () => ({ pid: 777, unref() {}, on() {}, stdout: null, stderr: null }), probe: () => true }); const started = controller.start({ command: 'test', cwd: process.cwd() }); const restarted = createDurableCommandController({ root, probe: () => false }); assert.equal(restarted.inspect(started.commandId).state, 'unknown');
});

test('durable command cancellation uses the owned process supervisor', () => {
  const root = path.join(mkdtempSync(path.join(tmpdir(), 'durable-command-owner-')), 'commands'); const calls = []; const supervisor = { own: (pid, metadata) => calls.push(['own', pid, metadata.commandId]), release: (pid) => calls.push(['release', pid]), list: () => [{ pid: 42, commandId: 'command-1', processStart: 7 }], terminate: (pid) => calls.push(['terminate', pid]) }; const controller = createDurableCommandController({ root, now: () => 7, supervisor, spawnImpl: () => ({ pid: 42, unref() {}, on() { return this; }, stdout: null, stderr: null }) });
  const started = controller.start({ command: 'test', cwd: process.cwd() }); assert.equal(started.processStart, 7); controller.stop(started.commandId); assert.deepEqual(calls[0], ['own', 42, started.commandId]); assert.deepEqual(calls.at(-1), ['terminate', 42]);
});
