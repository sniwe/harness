export const COMMAND_PROFILES = Object.freeze({
  'app-focused': {}, 'app-browser': {}, 'qwen-focused': {}, 'qwen-benchmark': {}
});

export function commandProfile(name, overrides = {}) { const profile = COMMAND_PROFILES[name]; if (!profile) throw new Error(`command_profile_unknown:${name}`); return { ...profile, ...overrides }; }
