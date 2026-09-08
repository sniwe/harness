import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

test('durable run IDs cannot escape the run root', () => {
  assert.throws(() => createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-safe-')), runId: '../outside' }), /run_id_invalid/);
});

test('start initializes a workflow after successful preflight', async () => {
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-start-')), runId: 'audep-speed-260908' }); const result = await runCommand('start', 'config/runs/audep-speed.json', { store, preflight: async () => ({ ok: true, state: 'ready' }) }); assert.equal(result.ok, true); assert.equal(result.command, 'start'); assert.equal(result.state.status, 'running'); assert.equal(result.next.stepId, 'A0'); const report = await runCommand('report', 'config/runs/audep-speed.json', { store }); assert.match(report.report, /run_initialized/);
});

test('start can hand the initialized workflow to a persistent executor', async () => {
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'run-start-execute-')), runId: 'audep-speed-260908' });
  let received;
  const result = await runCommand('start', 'config/runs/audep-speed.json', {
    store,
    execute: true,
    preflight: async () => ({ ok: true, state: 'ready' }),
    executorFactory: ({ manifest, workflow }) => ({ run: async () => { received = { runId: manifest.runId, next: workflow.next().stepId }; return { status: 'accepted' }; } }),
  });
  assert.deepEqual(received, { runId: 'audep-speed-260908', next: 'A0' });
  assert.equal(result.state.status, 'accepted');
});

test('rehearsal exports its report without changing the workflow contract', async () => {
  const manifestFile = 'config/runs/audep-speed-local.json'; const outFile = path.join(mkdtempSync(path.join(tmpdir(), 'rehearsal-report-')), 'run-report.md'); const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'rehearsal-export-')), runId: 'audep-speed-local-260908' });
  const result = await runCommand('rehearse', manifestFile, { store, outFile, fixture: true });
  assert.match(result.report, /PASS/);
  assert.match(result.report, /app-during-upload: not_observed/);
  assert.match(result.report, /NOT_EVALUATED/);
  assert.equal(result.reportFile, outFile);
  assert.equal(existsSync(outFile), true);
  assert.match(readFileSync(outFile, 'utf8'), /Evidence index/);
});

test('report returns failure when final acceptance evidence blocks the run', async () => {
  const store = createRunStore({ root: mkdtempSync(path.join(tmpdir(), 'report-gate-')), runId: 'audep-speed-local-260908' });
  const started = await runCommand('start', 'config/runs/audep-speed-local.json', { store, preflight: async () => ({ ok: true, state: 'ready' }) });
  assert.equal(started.ok, true);
  const acceptanceFile = path.join(mkdtempSync(path.join(tmpdir(), 'acceptance-')), 'bundle.json');
  writeFileSync(acceptanceFile, JSON.stringify({ app: { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.mp3', durationMs: 1 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a', qwenGeneration: 'q' }, verdict: 'blocked' }, qwen: { schemaVersion: 1, benchmarkId: 'b', runId: 'r', requestArtifactId: 'a'.repeat(64), source: { basename: '987.mp3', durationMs: 1 }, job: { remoteJobId: 'j' }, runtime: { appGeneration: 'a', qwenGeneration: 'q' }, verdict: 'blocked' }, restarts: [] }));
  const report = await runCommand('report', 'config/runs/audep-speed-local.json', { store, acceptanceFile });
  assert.equal(report.ok, false);
  assert.match(report.report, /bilateral_benchmark_failed/);
});
