import fs from 'node:fs';
import path from 'node:path';

export function acquireProjectLease(root, { projectKey, pid = process.pid, now = Date.now(), processStart = now, isAlive = (ownerPid) => { try { process.kill(ownerPid, 0); return true; } catch { return false; } } } = {}) {
  if (!projectKey) throw new Error('project_key_required'); fs.mkdirSync(root, { recursive: true }); const file = path.join(root, `${projectKey}.lease`); const lease = { schemaVersion: 1, projectKey, pid, processStart, acquiredAt: new Date(now).toISOString() };
  try { const fd = fs.openSync(file, 'wx'); fs.writeSync(fd, JSON.stringify(lease)); fs.closeSync(fd); } catch (error) { if (error.code !== 'EEXIST') throw error; let owner; try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { owner = null; } if (!owner || !isAlive(Number(owner.pid), owner, processStart)) { try { fs.unlinkSync(file); } catch {} return acquireProjectLease(root, { projectKey, pid, now, processStart, isAlive }); } throw new Error('project_lease_busy'); }
  const assertOwned = () => { let current; try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') throw new Error('project_lease_lost'); throw error; } if (current.pid !== pid || current.processStart !== processStart) throw new Error('project_lease_owner_mismatch'); return current; };
  const renew = (renewedAt = Date.now()) => { const current = assertOwned(); const next = { ...current, renewedAt: new Date(renewedAt).toISOString() }; fs.writeFileSync(file, JSON.stringify(next)); return next; };
  return { file, lease, assertOwned, renew, release() { try { assertOwned(); fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } } };
}
