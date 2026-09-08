import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createAttemptStore(root) {
  const directory = path.join(root, 'attempts'); fs.mkdirSync(directory, { recursive: true });
  function begin(input) { const attemptId = input.attemptId || crypto.randomUUID(); const dir = path.join(directory, attemptId); fs.mkdirSync(dir, { recursive: true }); const record = { schemaVersion: 1, attemptId, ...input, startedAt: input.startedAt || new Date().toISOString() }; fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify(record, null, 2)); return record; }
  function finish(attemptId, outcome) { const file = path.join(directory, attemptId, 'outcome.json'); if (!fs.existsSync(path.dirname(file))) throw new Error('attempt_missing'); fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, attemptId, ...outcome, finishedAt: new Date().toISOString() }, null, 2)); return JSON.parse(fs.readFileSync(file, 'utf8')); }
  function recover() { return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => { const dir = path.join(directory, entry.name); return { input: JSON.parse(fs.readFileSync(path.join(dir, 'input.json'), 'utf8')), outcome: fs.existsSync(path.join(dir, 'outcome.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'outcome.json'), 'utf8')) : null }; }); }
  return { begin, finish, recover, directory };
}
