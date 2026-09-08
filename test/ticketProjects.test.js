import assert from 'node:assert/strict';
import test from 'node:test';
import { readTicketProject } from '../src/ticketProjects.js';

test('project routing resolves only enabled absolute roots', () => {
  const project = readTicketProject('qwen-asr'); assert.equal(project.root, 'C:\\Users\\rhyse\\Qwen3-ASR'); assert.throws(() => readTicketProject('missing'), /ticket_project_invalid/);
});

test('project root comparison is exact after native separator normalization', () => {
  const normalize = (value) => value.toLowerCase().replace(/[\\/]+/g, '\\').replace(/\\+$/, ''); assert.equal(normalize('C:\\retry\\'), normalize('c:/retry'));
});
