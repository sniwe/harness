import fs from 'node:fs';
import path from 'node:path';

export function createTicketJournal(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  function read() { if (!fs.existsSync(file)) return []; const lines = fs.readFileSync(file, 'utf8').split('\n'); const entries = []; for (let index = 0; index < lines.length; index += 1) { const line = lines[index]; if (!line) continue; try { entries.push(JSON.parse(line)); } catch { if (index === lines.length - 1) break; throw new Error('journal_corrupt'); } } return entries; }
  function append(entry) { const fd = fs.openSync(file, 'a'); try { fs.writeSync(fd, `${JSON.stringify(entry)}\n`, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
  function replace(entries) { const temporary = `${file}.${process.pid}.${Date.now()}.tmp`; const fd = fs.openSync(temporary, 'w'); try { fs.writeSync(fd, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(''), null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(temporary, file); }
  return { read, append, replace };
}
