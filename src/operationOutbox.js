import fs from 'node:fs';
import path from 'node:path';

export function createOperationOutbox(root) {
  const directory = path.join(root, 'operations'); fs.mkdirSync(directory, { recursive: true });
  function intent(operationId, operation) { const file = path.join(directory, `${operationId}.json`); if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); const record = { schemaVersion: 1, operationId, status: 'intent', ...operation }; fs.writeFileSync(file, JSON.stringify(record, null, 2)); return record; }
  function result(operationId, outcome) { const file = path.join(directory, `${operationId}.json`); if (!fs.existsSync(file)) throw new Error('operation_intent_missing'); const record = { ...JSON.parse(fs.readFileSync(file, 'utf8')), status: 'complete', outcome }; fs.writeFileSync(file, JSON.stringify(record, null, 2)); return record; }
  function pending() { return fs.readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))).filter((record) => record.status === 'intent'); }
  return { intent, result, pending, directory };
}
