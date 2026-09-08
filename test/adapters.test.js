import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveAppBenchmarkAdapter } from '../src/appAdapter.js';
import { resolveQwenBenchmarkAdapter } from '../src/qwenAdapter.js';

test('benchmark adapters require explicit real verifier and source paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'adapters-')); const verifier = path.join(root, 'verify.mjs'); const source = path.join(root, '987 source.mp3'); fs.writeFileSync(verifier, ''); fs.writeFileSync(source, '');
  const adapter = resolveAppBenchmarkAdapter({ projectRoot: root, verifier: 'verify.mjs', source: '987 source.mp3', appUrl: 'http://127.0.0.1:45673' }); assert.equal(adapter.args[0], verifier); assert.equal(adapter.env.AUDEP_987_SOURCE, source); assert.equal(adapter.env.AUDEP_APP_URL, 'http://127.0.0.1:45673'); assert.throws(() => resolveAppBenchmarkAdapter({ projectRoot: root, verifier: 'verify.mjs', source: 'other.mp3' }), /source_invalid/);
  const python = path.join(root, 'python.exe'); const tracer = path.join(root, 'tracer.py'); const fixture = path.join(root, 'fixture'); fs.mkdirSync(path.join(fixture, 'chunks'), { recursive: true }); fs.writeFileSync(python, ''); fs.writeFileSync(tracer, ''); fs.writeFileSync(path.join(fixture, 'manifest.json'), JSON.stringify({ mediaDurationMs: 1, sourceAudioRevision: 'sha256:' + 'a'.repeat(64), planVersion: 'v1', planCalls: [{ index: 0 }] })); fs.writeFileSync(path.join(fixture, 'chunks', '00000000.pcm.f32le'), ''); const qwen = resolveQwenBenchmarkAdapter({ projectRoot: root, python, tracer: 'tracer.py', fixtureJob: 'fixture' }); assert.equal(qwen.args[0], tracer); assert.equal(qwen.fixture.planCalls, 1); assert.throws(() => resolveQwenBenchmarkAdapter({ projectRoot: root, python, tracer: 'tracer.py' }), /fixture_missing/);
});
