import fs from 'node:fs';
import path from 'node:path';

export function createTicketJournal(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  function read() { if (!fs.existsSync(file)) return []; return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
  function append(entry) { const fd = fs.openSync(file, 'a'); try { fs.writeSync(fd, `${JSON.stringify(entry)}\n`, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  return { read, append };
}
