import fs from 'node:fs';
import path from 'node:path';

export function acquireProjectLease(root, { projectKey, pid = process.pid, now = Date.now() } = {}) {
  if (!projectKey) throw new Error('project_key_required'); fs.mkdirSync(root, { recursive: true }); const file = path.join(root, `${projectKey}.lease`); const lease = { schemaVersion: 1, projectKey, pid, processStart: now, acquiredAt: new Date(now).toISOString() };
  try { const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, JSON.stringify(lease)); fs.closeSync(fd); } catch { throw new Error('project_lease_busy'); }
  return { file, lease, release() { try { const current = JSON.parse(fs.readFileSync(file, 'utf8')); if (current.pid !== pid || current.processStart !== now) throw new Error('project_lease_owner_mismatch'); fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } } };
}
