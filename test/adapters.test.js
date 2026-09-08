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
  const adapter = resolveAppBenchmarkAdapter({ projectRoot: root, verifier: 'verify.mjs', source: '987 source.mp3' }); assert.equal(adapter.args[0], verifier); assert.equal(adapter.env.AUDEP_987_SOURCE, source); assert.throws(() => resolveAppBenchmarkAdapter({ projectRoot: root, verifier: 'verify.mjs', source: 'other.mp3' }), /source_invalid/);
  const python = path.join(root, 'python.exe'); const tracer = path.join(root, 'tracer.py'); fs.writeFileSync(python, ''); fs.writeFileSync(tracer, ''); assert.equal(resolveQwenBenchmarkAdapter({ projectRoot: root, python, tracer: 'tracer.py' }).args[0], tracer);
});
