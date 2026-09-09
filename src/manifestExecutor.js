import fs from 'node:fs';
import path from 'node:path';
import { createRunExecutor } from './runExecutor.js';

export function resolveManifestCommand({ manifest, step } = {}) {
  const spec = manifest?.commands?.[step?.stepId];
  if (!spec || typeof spec.command !== 'string' || !spec.command.trim() || !Array.isArray(spec.args || [])) throw new Error(`execution_command_missing:${step?.stepId || 'unknown'}`);
  const projectRoot = manifest.projects?.[step.owner]?.profile;
  const cwd = path.resolve(spec.cwd || projectRoot || '');
  if (!projectRoot || path.resolve(projectRoot) !== cwd) throw new Error(`execution_cwd_mismatch:${step.stepId}`);
  if (spec.command.includes('/') || spec.command.includes('\\')) {
    const commandPath = path.isAbsolute(spec.command) ? spec.command : path.resolve(cwd, spec.command);
    if (!fs.existsSync(commandPath)) throw new Error(`execution_command_missing:${step.stepId}`);
  }
  return { command: spec.command, args: spec.args || [], cwd, env: { ...process.env, ...(spec.env || {}) } };
}

export function validateManifestCommands(manifest) {
  const missing = [];
  for (const step of manifest?.steps || []) {
    try { resolveManifestCommand({ manifest, step }); } catch (error) { missing.push({ stepId: step.stepId, error: error.message }); }
  }
  return { ok: missing.length === 0, missing };
}

export function createManifestExecutor({ workflow, manifest, durableCommandController, ...options } = {}) {
  return createRunExecutor({ workflow, manifest, durableCommandController, resolveCommand: resolveManifestCommand, ...options });
}
