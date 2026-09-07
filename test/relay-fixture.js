import http from "node:http";
const records = new Map();
const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/relay") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { const payload = JSON.parse(body); records.set(payload.tunnelKey, payload.tunnelUrl); response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ ok: true, tunnelUrl: records.get(payload.tunnelKey) })); });
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: true, records: Object.fromEntries(records) }));
});
server.listen(Number(process.env.RELAY_PORT || 3411), "127.0.0.1", () => console.log("relay-ready"));
process.once("SIGINT", () => server.close(() => process.exit(0)));
