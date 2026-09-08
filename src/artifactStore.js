import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createArtifactStore(root) {
  const directory = path.join(root, 'artifacts', 'sha256'); fs.mkdirSync(directory, { recursive: true });
  function put(value, { mediaType = 'application/octet-stream' } = {}) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'); const artifactId = crypto.createHash('sha256').update(bytes).digest('hex'); const file = path.join(directory, artifactId);
    if (fs.existsSync(file) && !bytes.equals(fs.readFileSync(file))) throw new Error('artifact_digest_collision');
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { flag: 'wx' });
    return { artifactId, byteLength: bytes.length, mediaType, file };
  }
  function get(artifactId) { if (!/^[0-9a-f]{64}$/.test(artifactId || '')) throw new Error('artifact_id_invalid'); const bytes = fs.readFileSync(path.join(directory, artifactId)); if (crypto.createHash('sha256').update(bytes).digest('hex') !== artifactId) throw new Error('artifact_corrupt'); return bytes; }
  return { put, get, directory };
}
