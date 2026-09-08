import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateHandoff } from './handoffSchemas.js';

export function transferArtifact({ store, descriptor, destination }) {
  validateHandoff(descriptor); const bytes = store.get(descriptor.artifact.sha256); if (bytes.length !== descriptor.artifact.byteLength) throw new Error('handoff_length_mismatch');
  fs.mkdirSync(destination, { recursive: true }); const file = path.join(destination, descriptor.filename); const digest = crypto.createHash('sha256').update(bytes).digest('hex'); if (digest !== descriptor.artifact.sha256) throw new Error('handoff_digest_mismatch');
  if (fs.existsSync(file) && !bytes.equals(fs.readFileSync(file))) throw new Error('handoff_destination_conflict'); fs.writeFileSync(file, bytes); return { ...descriptor, received: { file, sha256: digest, byteLength: bytes.length } };
}
