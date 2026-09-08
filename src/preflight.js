import fs from 'node:fs';
import path from 'node:path';
import { readRunManifest } from './runManifest.js';
import { readTicketProject } from './ticketProjects.js';

export function preflightManifest(file, { projectConfig = path.resolve('config/tickets.projects.json') } = {}) {
  try {
    const manifest = readRunManifest(file);
    const projects = Object.entries(manifest.projects).map(([projectKey, value]) => {
      const project = readTicketProject(projectKey, projectConfig);
      if (value.profile !== project.root && value.root !== project.root) throw new Error(`project_root_mismatch:${projectKey}`);
      return { projectKey, root: project.root, exists: fs.existsSync(project.root) };
    });
    const missing = projects.filter((project) => !project.exists);
    return { ok: missing.length === 0, state: missing.length ? 'blocked' : 'ready', manifest: { runId: manifest.runId, planDigest: manifest.planDigest }, projects, missing };
  } catch (error) { return { ok: false, state: 'blocked', error: error.message }; }
}
