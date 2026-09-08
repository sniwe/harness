import fs from 'node:fs';
import path from 'node:path';

export function createOperationOutbox(root) {
  const directory = path.join(root, 'operations'); fs.mkdirSync(directory, { recursive: true });
  const fileFor = (operationId) => { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(operationId || '')) throw new Error('operation_id_invalid'); return path.join(directory, `${encodeURIComponent(operationId)}.json`); };
  const write = (file, value) => { const temporary = `${file}.${process.pid}.${Date.now()}.tmp`; const fd = fs.openSync(temporary, 'wx'); try { fs.writeSync(fd, JSON.stringify(value, null, 2) + '\n', null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } try { fs.renameSync(temporary, file); } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } } };
  function intent(operationId, operation) { const file = fileFor(operationId); if (fs.existsSync(file)) { const existing = JSON.parse(fs.readFileSync(file, 'utf8')); if (Object.entries(operation || {}).some(([key, value]) => JSON.stringify(existing[key]) !== JSON.stringify(value))) throw new Error('operation_id_reuse_conflict'); return existing; } const record = { schemaVersion: 1, operationId, status: 'intent', ...operation }; write(file, record); return record; }
  function result(operationId, outcome) { const file = fileFor(operationId); if (!fs.existsSync(file)) throw new Error('operation_intent_missing'); const record = { ...JSON.parse(fs.readFileSync(file, 'utf8')), status: 'complete', outcome }; write(file, record); return record; }
  function pending() { return fs.readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))).filter((record) => record.status === 'intent'); }
  return { intent, result, pending, directory };
}
