import fs from 'node:fs';
import path from 'node:path';
import { createTicketClient } from './ticketClient.js';
import { readTicketIdentity } from './ticketIdentity.js';
import { createTicketLog } from './ticketLog.js';
import { createTicketJournal } from './ticketJournal.js';
import { createTicketReconciler } from './ticketReconciler.js';

const args = process.argv.slice(2); const command = args[0]; const value = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
function setup() { const identity = readTicketIdentity(); const client = createTicketClient({ baseUrl: process.env.TICKETS_BASE_URL }); const log = createTicketLog({ root: identity.logRoot, machineKey: identity.machineKey, projectKey: identity.projectKey }); return { identity, client, log }; }
async function main() { const { identity, client, log } = setup(); if (command === 'status') return console.log(JSON.stringify({ ok: true, identity, enabled: process.env.TICKETS_ENABLED === '1' })); if (command === 'inspect') return console.log(JSON.stringify(await client.get(value('--ticket')))); if (command === 'wake') { log.append({ event: 'wake_requested', ticketId: value('--ticket') }); return console.log(JSON.stringify({ ok: true, ticketId: value('--ticket') })); } if (command === 'reconcile') { const reconciler = createTicketReconciler({ client, identity, log: (event) => log.append(event) }); return console.log(JSON.stringify(await reconciler.once())); } if (command === 'create') { const payload = JSON.parse(fs.readFileSync(path.resolve(value('--file')), 'utf8')); const result = await client.create(payload); log.append({ event: 'ticket_created', ticketId: payload.ticketId, body: payload.body }); return console.log(JSON.stringify(result)); } throw new Error('ticket_command_invalid'); }
main().catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
