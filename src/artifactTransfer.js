import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateHandoff } from "./handoffSchemas.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
export const MAX_ARTIFACT_CHUNK_BYTES = 256 * 1024;

function transferError(status, error) { return Object.assign(new Error(error), { status }); }

export function validateArtifactChunk(payload, { targetKey, maxChunkBytes = MAX_ARTIFACT_CHUNK_BYTES } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw transferError(400, "artifact_chunk_invalid");
  if (!UUID.test(payload.transferId || "")) throw transferError(400, "artifact_transfer_id_invalid");
  if (payload.targetKey !== targetKey) throw transferError(400, "artifact_target_invalid");
  if (!HASH.test(payload.sha256 || "") || !Number.isInteger(payload.totalLength) || payload.totalLength < 0) throw transferError(400, "artifact_descriptor_invalid");
  if (!Number.isInteger(payload.offset) || payload.offset < 0 || payload.offset > payload.totalLength) throw transferError(400, "artifact_offset_invalid");
  if (typeof payload.chunkBase64 !== "string") throw transferError(400, "artifact_chunk_encoding_invalid");
  let chunk;
  try { chunk = Buffer.from(payload.chunkBase64, "base64"); } catch { throw transferError(400, "artifact_chunk_encoding_invalid"); }
  if (chunk.length > maxChunkBytes || payload.offset + chunk.length > payload.totalLength) throw transferError(413, "artifact_chunk_too_large");
  if (payload.final !== (payload.offset + chunk.length === payload.totalLength)) throw transferError(400, "artifact_final_invalid");
  const allowed = new Set(["transferId", "targetKey", "sha256", "totalLength", "offset", "chunkBase64", "final", "filename"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw transferError(400, "artifact_fields_invalid");
  return { ...payload, chunk };
}

function safeFilename(filename) {
  if (typeof filename !== "string" || !filename || filename !== path.basename(filename) || filename === "." || filename === "..") throw transferError(400, "artifact_filename_invalid");
  return filename;
}

export function createArtifactTransferHandler({ root, targetKey, enabled = true, maxChunkBytes = MAX_ARTIFACT_CHUNK_BYTES } = {}) {
  if (!root || !targetKey) throw new Error("artifact_transfer_config_invalid");
  const partsRoot = path.join(root, ".transfers");
  const destinationRoot = path.join(root, "received");
  fs.mkdirSync(partsRoot, { recursive: true });
  fs.mkdirSync(destinationRoot, { recursive: true });
  const fileFor = (transferId) => path.join(partsRoot, `${transferId}.part`);
  const metadataFor = (transferId) => path.join(partsRoot, `${transferId}.json`);
  function handle(payload) {
  if (!enabled) return { status: 403, body: { ok: false, error: "artifact_route_disabled" } };
    let request;
    let filename;
    try {
      request = validateArtifactChunk(payload, { targetKey, maxChunkBytes });
      filename = safeFilename(request.filename || `${request.sha256}.artifact`);
    } catch (error) { return { status: error.status || 400, body: { ok: false, error: error.message } }; }
    const part = fileFor(request.transferId);
    const metadata = metadataFor(request.transferId);
    let current = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (fs.existsSync(metadata)) {
      const saved = JSON.parse(fs.readFileSync(metadata, "utf8"));
      if (saved.sha256 !== request.sha256 || saved.totalLength !== request.totalLength || saved.filename !== filename) return { status: 409, body: { ok: false, error: "artifact_transfer_identity_conflict" } };
    } else {
      fs.writeFileSync(metadata, JSON.stringify({ transferId: request.transferId, sha256: request.sha256, totalLength: request.totalLength, filename }) + "\n", "utf8");
    }
    if (request.offset !== current) return { status: 409, body: { ok: false, error: "artifact_offset_conflict", nextOffset: current } };
    if (request.chunk.length) { const fd = fs.openSync(part, "a"); try { fs.writeSync(fd, request.chunk); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } current += request.chunk.length; }
    if (!request.final) return { status: 202, body: { ok: true, state: "in_progress", transferId: request.transferId, nextOffset: current } };
    const bytes = fs.readFileSync(part);
    if (bytes.length !== request.totalLength || crypto.createHash("sha256").update(bytes).digest("hex") !== request.sha256) return { status: 409, body: { ok: false, error: "artifact_digest_mismatch", nextOffset: current } };
    const destination = path.join(destinationRoot, filename);
    if (fs.existsSync(destination) && !bytes.equals(fs.readFileSync(destination))) return { status: 409, body: { ok: false, error: "artifact_destination_conflict" } };
    if (!fs.existsSync(destination)) { const temporary = `${destination}.${request.transferId}.tmp`; fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, destination); }
    fs.unlinkSync(part); fs.unlinkSync(metadata);
    return { status: 200, body: { ok: true, state: "completed", transferId: request.transferId, filename, sha256: request.sha256, byteLength: bytes.length, file: destination } };
  }
  return { handle, state: { enabled, root, destinationRoot } };
}

export async function transferArtifactRemote({ peerPing, peerKey, descriptor, store, fetchImpl = fetch, chunkBytes = MAX_ARTIFACT_CHUNK_BYTES, signal, transferId = crypto.randomUUID() } = {}) {
  validateHandoff(descriptor);
  if (!store?.get || !peerPing?.lookup || !peerKey) throw new Error("artifact_transfer_client_invalid");
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > MAX_ARTIFACT_CHUNK_BYTES) throw new Error("artifact_chunk_size_invalid");
  const bytes = store.get(descriptor.artifact.sha256);
  if (bytes.length !== descriptor.artifact.byteLength) throw new Error("artifact_length_mismatch");
  let offset = 0;
  while (offset < bytes.length || (bytes.length === 0 && offset === 0)) {
    if (signal?.aborted) throw new Error("artifact_transfer_cancelled");
    const peer = await peerPing.lookup(peerKey, { signal });
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkBytes));
    const payload = { transferId, targetKey: peer.tunnelKey, sha256: descriptor.artifact.sha256, totalLength: bytes.length, offset, chunkBase64: chunk.toString("base64"), final: offset + chunk.length === bytes.length, filename: descriptor.filename };
    const response = await fetchImpl(`${peer.tunnelUrl}/api/machine-base/artifact-chunk`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "error", ...(signal ? { signal } : {}) });
    const body = await response.json();
    if (!response.ok) { if (response.status === 409 && Number.isInteger(body.nextOffset)) { offset = body.nextOffset; continue; } throw new Error(body.error || `artifact_transfer_http_${response.status}`); }
    if (!body || body.transferId !== transferId || !Number.isInteger(body.nextOffset)) throw new Error("artifact_transfer_response_invalid");
    if (body.state === "completed") return { ...descriptor, received: body };
    offset = body.nextOffset;
  }
  throw new Error("artifact_transfer_incomplete");
}
