import fs from 'node:fs';
import path from 'node:path';
import { deriveMachineIdentity } from './machineIdentity.js';

export function readTicketIdentity({ env = process.env, dataRoot = path.resolve(env.MACHINE_BASE_DATA_ROOT || 'data/machine-base') } = {}) {
  const identity = deriveMachineIdentity({ env: { ...env, MACHINE_BASE_IDENTITY_PATH: path.join(dataRoot, 'identity.json') } });
  const machineKey = String(env.TICKETS_MACHINE_KEY || identity.tunnelKey).trim();
  const projectKey = String(env.TICKETS_PROJECT_KEY || '').trim();
  if (!/^machine-base-[a-z0-9-]+$/.test(machineKey) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(projectKey)) throw new Error('ticket_identity_invalid');
  fs.mkdirSync(dataRoot, { recursive: true });
  return { machineKey, projectKey, dataRoot, logRoot: path.resolve(env.TICKETS_LOG_ROOT || 'mgmt/logs') };
}
