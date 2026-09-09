import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createAttemptStore(root) {
  const directory = path.join(root, 'attempts'); fs.mkdirSync(directory, { recursive: true });
  const validId = (attemptId) => { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(attemptId || '')) throw new Error('attempt_id_invalid'); return attemptId; };
  const writeJson = (file, value) => { const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`; const fd = fs.openSync(temporary, 'wx'); try { fs.writeSync(fd, JSON.stringify(value, null, 2) + '\n', null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } try { fs.renameSync(temporary, file); } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } } };
  function begin(input) { const attemptId = validId(input.attemptId || crypto.randomUUID()); const dir = path.join(directory, attemptId); fs.mkdirSync(dir, { recursive: true }); const record = { schemaVersion: 1, attemptId, ...input, startedAt: input.startedAt || new Date().toISOString() }; writeJson(path.join(dir, 'input.json'), record); return record; }
  function updateInput(attemptId, patch) { validId(attemptId); const file = path.join(directory, attemptId, 'input.json'); if (!fs.existsSync(file)) throw new Error('attempt_missing'); const record = JSON.parse(fs.readFileSync(file, 'utf8')); const next = { ...record, ...patch, attemptId }; writeJson(file, next); return next; }
  function finish(attemptId, outcome) { validId(attemptId); const file = path.join(directory, attemptId, 'outcome.json'); if (!fs.existsSync(path.dirname(file))) throw new Error('attempt_missing'); const record = { schemaVersion: 1, attemptId, ...outcome, finishedAt: new Date().toISOString() }; writeJson(file, record); return record; }
  function recover() { return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => { const dir = path.join(directory, entry.name); return { input: JSON.parse(fs.readFileSync(path.join(dir, 'input.json'), 'utf8')), outcome: fs.existsSync(path.join(dir, 'outcome.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'outcome.json'), 'utf8')) : null }; }); }
  return { begin, updateInput, finish, recover, directory };
}
