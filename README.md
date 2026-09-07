# Machine-base server

Standalone Node.js service for a loopback HTTP API, supervised Codex worker
pair, and rotating Cloudflare quick tunnel.

## Run

```powershell
npm test
$env:TUNNEL_RELAY_BASE_URL = "https://your-always-online-host"
$env:TUNNEL_RELAY_PATH = "/_functions/tunnelRelay"
$env:TUNNEL_RELAY_LOCAL_URL = "http://127.0.0.1:3100"
$env:CODEX_BIN = "$env:APPDATA\npm\codex.cmd"
npm start
```

The relay receives `{ tunnelKey, tunnelUrl }`. If `TUNNEL_KEY` is omitted, the
server derives a stable hashed key from the Windows machine identity and stores
it in `data/machine-base/identity.json`. Set `MACHINE_BASE_FAKE=1` only for local
worker tests. The real endpoint contract and authentication must be supplied
before production use.

Routes: `GET /health`, `GET /status`, `GET /setup/status`, and
`POST /api/machine-base/request`.
