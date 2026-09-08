import fs from 'node:fs';
import path from 'node:path';

export function readTicketProject(projectKey, file = path.resolve('config/tickets.projects.json')) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8')); const project = config.projects?.[projectKey];
  if (!project?.enabled || typeof project.root !== 'string' || !isNativeAbsolute(project.root)) throw new Error('ticket_project_invalid');
  return { projectKey, root: project.root.replace(/[\\/]$/, '') };
}

function isNativeAbsolute(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+[\\/][^\\]+/.test(value);
}
