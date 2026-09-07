import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PLACEHOLDERS = new Set(["", "none", "unknown", "default string", "to be filled by o.e.m.", "system serial number"]);

export function deriveMachineIdentity({ env = process.env, platform = process.platform, exec = execFileSync } = {}) {
  const candidates = platform === "win32"
    ? [
      ["machine-guid", () => regValue(exec)],
      ["system-product-uuid", () => cimValue(exec, "Win32_ComputerSystemProduct", "UUID")],
      ["bios-baseboard", () => `${cimValue(exec, "Win32_BIOS", "SerialNumber")}|${cimValue(exec, "Win32_BaseBoard", "SerialNumber")}`],
      ["system-disk-serial", () => cimValue(exec, "Win32_DiskDrive", "SerialNumber")]
    ]
    : platform === "linux"
      ? [["machine-id", () => fs.existsSync("/etc/machine-id") ? fs.readFileSync("/etc/machine-id", "utf8") : ""]]
      : platform === "darwin"
        ? [["ioreg-platform-uuid", () => ioregValue(exec)]]
        : [];

  for (const [source, read] of candidates) {
    let value = "";
    try { value = normalize(read()); } catch { value = ""; }
    if (value && !PLACEHOLDERS.has(value)) {
      return makeIdentity(source, value);
    }
  }

  const persistedPath = env.MACHINE_BASE_IDENTITY_PATH || "";
  if (persistedPath && fs.existsSync(persistedPath)) {
    const saved = JSON.parse(fs.readFileSync(persistedPath, "utf8"));
    if (saved?.machineBaseId && saved?.tunnelKey) return saved;
  }
  if (!persistedPath) throw new Error("No reliable machine identity available; set MACHINE_BASE_IDENTITY_PATH for explicit UUID fallback.");
  const value = crypto.randomUUID();
  const identity = makeIdentity("generated-persisted", value);
  fs.mkdirSync(path.dirname(persistedPath), { recursive: true });
  try { fs.writeFileSync(persistedPath, JSON.stringify(identity, null, 2), { encoding: "utf8", flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; return JSON.parse(fs.readFileSync(persistedPath, "utf8")); }
  return identity;
}

function makeIdentity(source, value) {
  const digest = crypto.createHash("sha256").update(`machine-base-id:v1:${value}`).digest("hex");
  return { algorithm: "sha256-v1", source, machineBaseId: digest, tunnelKey: `machine-base-${digest.slice(0, 20)}` };
}

function normalize(value) {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return text === "nan" ? "" : text;
}

function regValue(exec) {
  const out = exec("reg.exe", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", windowsHide: true });
  return String(out).match(/MachineGuid\s+REG_[A-Z]+\s+(.+)/i)?.[1] || "";
}

function cimValue(exec, klass, property) {
  const script = `(Get-CimInstance ${klass} | Select-Object -First 1 -ExpandProperty ${property})`;
  try { return exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true }); } catch { return ""; }
}

function ioregValue(exec) {
  try {
    const out = exec("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
    return String(out).match(/IOPlatformUUID"\s*=\s*"([^"]+)/)?.[1] || "";
  } catch { return ""; }
}
