# Machine-base server

Standalone Node.js service for a loopback HTTP API, supervised Codex worker
pair, and rotating Cloudflare quick tunnel.

## Run

```powershell
npm test
$env:TUNNEL_RELAY_LOCAL_URL = "http://127.0.0.1:3100"
$env:CODEX_BIN = "$env:APPDATA\npm\codex.cmd"
npm start
```

The relay receives `{ tunnelKey, tunnelUrl }`. If `TUNNEL_KEY` is omitted, the
server derives a stable hashed key from the Windows machine identity and stores
it in `data/machine-base/identity.json`. Set `MACHINE_BASE_FAKE=1` only for local
worker tests. The real endpoint contract and authentication must be supplied
The default relay is the documented Wix `/_functions/tunnelRelay` endpoint;
override `TUNNEL_RELAY_BASE_URL` and `TUNNEL_RELAY_PATH` when using another
always-online endpoint. `CLOUDFLARED_PATH` is optional and otherwise resolves
from the machine's `PATH`.

Routes: `GET /health`, `GET /status`, `GET /setup/status`, and
`POST /api/machine-base/request`.

Set `PORT=0` when the local relay service must use an OS-assigned free port. The
server waits for the actual bound port, then constructs the tunnel origin from
that port before starting `cloudflared` and publishing the URL.
