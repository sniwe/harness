export const COMMAND_PROFILES = Object.freeze({
  'app-focused': { timeoutMs: 30 * 60 * 1000 }, 'app-browser': { timeoutMs: 60 * 60 * 1000 }, 'qwen-focused': { timeoutMs: 30 * 60 * 1000 }, 'qwen-benchmark': { timeoutMs: 4 * 60 * 60 * 1000 }
});

export function commandProfile(name, overrides = {}) { const profile = COMMAND_PROFILES[name]; if (!profile) throw new Error(`command_profile_unknown:${name}`); return { ...profile, ...overrides }; }
