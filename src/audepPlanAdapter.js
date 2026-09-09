import { gateFor } from './audepGateCatalog.js';

const ALIASES = Object.freeze({
  'main-app-speed-a5-adaptive-boundary-v2-acceptance.md': 'main-app-speed-a6-adaptive-boundary-v2-acceptance.md',
  'main-app-speed-a6-final-cross-machine-acceptance.md': 'main-app-speed-a7-final-cross-machine-acceptance.md'
});

export function canonicalArtifactName(filename) { return ALIASES[filename] || filename; }
export function adaptAudepSteps(steps) { return steps.map((step) => ({ ...step, gateId: gateFor(step.stepId), artifactFilename: canonicalArtifactName(step.artifactFilename || `${step.stepId.toLowerCase()}-acceptance.md`) })); }
export function isExactArtifactMatch(expected, actual) { return expected === actual || (canonicalArtifactName(expected) === canonicalArtifactName(actual) && (canonicalArtifactName(expected) === actual || canonicalArtifactName(actual) === expected)); }
