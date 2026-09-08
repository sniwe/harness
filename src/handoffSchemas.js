const HASH = /^[0-9a-f]{64}$/;
export function validateHandoff(descriptor) {
  if (!descriptor || descriptor.schemaVersion !== 1 || !descriptor.runId || !descriptor.artifactType || !descriptor.producerPhase || !descriptor.producer?.machineKey || !descriptor.producer?.projectKey || !/^[0-9a-f]{40}$/.test(descriptor.producer?.commit || '') || !descriptor.producer?.runtimeGeneration || !descriptor.consumer?.machineKey || !descriptor.consumer?.projectKey || !descriptor.consumer?.phase || !descriptor.filename || !descriptor.requiredAcceptanceType) throw new Error('handoff_invalid');
  if (descriptor.filename !== descriptor.filename.split(/[\\/]/).pop() || descriptor.filename === '.' || descriptor.filename === '..') throw new Error('handoff_filename_invalid');
  if (!HASH.test(descriptor.artifact?.sha256 || '') || !Number.isInteger(descriptor.artifact.byteLength) || descriptor.artifact.byteLength < 0 || !descriptor.artifact.mediaType) throw new Error('handoff_artifact_invalid');
  return true;
}

export function createHandoff({ runId, artifactType, producerPhase, producer, artifact, consumer, filename, requiredAcceptanceType }) {
  const descriptor = { schemaVersion: 1, runId, artifactType, producerPhase, producer, artifact, consumer, filename, requiredAcceptanceType };
  validateHandoff(descriptor); return descriptor;
}
