process.env.MACHINE_BASE_FAKE = "1";
process.env.PORT = "3450";
process.env.TUNNEL_RELAY_BASE_URL = "https://dev-sitex2082572611.wixdev-sites.org/";
process.env.TUNNEL_RELAY_PATH = "/_functions/tunnelRelay";
process.env.TUNNEL_RELAY_LOCAL_URL = "http://127.0.0.1:3450";
process.env.TUNNEL_RETRY_DELAY_MS = "5000";
process.env.MACHINE_BASE_NO_START = "1";

const app = await import("../src/server.js");
async function retryFetch(url, init) {
  let lastError;
  for (let attempt = 1; attempt <= 48; attempt += 1) {
    try { const response = await fetch(url, init); if (response.ok) return response.json(); lastError = new Error(`http_${response.status}`); }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw lastError;
}

try {
  await app.start();
  const status = await fetch("http://127.0.0.1:3450/status").then((response) => response.json());
  const tunnelUrl = status.tunnel.publishedUrl;
  const publicHealth = await retryFetch(`${tunnelUrl}/health`);
  const publicWorker = await retryFetch(`${tunnelUrl}/api/machine-base/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "wix-live-proof" }) });
  console.log(JSON.stringify({ tunnelKey: status.identity.tunnelKey, publishedUrl: tunnelUrl, publicHealth, publicWorker }));
} finally { await app.stop(); }
