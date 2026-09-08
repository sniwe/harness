import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateHandoff } from './handoffSchemas.js';

export function transferArtifact({ store, descriptor, destination }) {
  validateHandoff(descriptor); const bytes = store.get(descriptor.artifact.sha256); if (bytes.length !== descriptor.artifact.byteLength) throw new Error('handoff_length_mismatch');
  fs.mkdirSync(destination, { recursive: true }); const file = path.join(destination, descriptor.filename); const digest = crypto.createHash('sha256').update(bytes).digest('hex'); if (digest !== descriptor.artifact.sha256) throw new Error('handoff_digest_mismatch');
  if (fs.existsSync(file)) { if (!bytes.equals(fs.readFileSync(file))) throw new Error('handoff_destination_conflict'); return { ...descriptor, received: { file, sha256: digest, byteLength: bytes.length } }; }
  const temporary = path.join(destination, `.${descriptor.filename}.${process.pid}.${crypto.randomUUID()}.tmp`); const fd = fs.openSync(temporary, 'wx'); try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } try { fs.renameSync(temporary, file); } catch (error) { if (error.code !== 'EEXIST' || !bytes.equals(fs.readFileSync(file))) throw error; } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } } return { ...descriptor, received: { file, sha256: digest, byteLength: bytes.length } };
}
