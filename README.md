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
worker tests. The real endpoint contract must be supplied.
The default relay is the documented Wix `/_functions/tunnelRelay` endpoint;
override `TUNNEL_RELAY_BASE_URL` and `TUNNEL_RELAY_PATH` when using another
always-online endpoint. `CLOUDFLARED_PATH` is optional and otherwise resolves
from the machine's `PATH`.

Routes: `GET /health`, `GET /status`, `GET /setup/status`, and
`GET /api/machine-base/ping`, `POST /api/machine-base/peer-ping`, and
`POST /api/machine-base/request`. Peer prompt execution is exposed through
`POST /api/machine-base/peer-request` and the local sender operation
`POST /api/machine-base/peer-request-send` only when explicitly enabled and
authenticated.

To ping another machine by its exact registry key:

```powershell
Invoke-RestMethod http://127.0.0.1:3100/api/machine-base/peer-ping -Method Post -ContentType 'application/json' -Body '{"tunnelKey":"machine-base-..."}'
```

The server resolves the current peer URL through the Wix `tunnels` endpoint and
contacts only its validated HTTPS quick-tunnel URL.

Remote prompts are deny-by-default. On the receiving machine, provision a
process-only `MACHINE_BASE_PEER_TOKEN`, set
`MACHINE_BASE_REMOTE_ALLOWED_CALLERS` to a comma-separated exact machine-base
key allowlist, and set `MACHINE_BASE_REMOTE_PROMPTS_ENABLED=1` only for an
approved canary window. The sender uses the same token and its own machine key.
The token is never stored in Wix, source, Git, logs, or Markdown. The existing
general worker route is disabled unless
`MACHINE_BASE_LOCAL_WORKER_REQUEST_ENABLED=1` is explicitly set, and it still
requires the bearer token plus the local machine key header. The sender route
also requires `MACHINE_BASE_PEER_REQUEST_SENDER_ENABLED=1` and the same local
authentication headers.

Commit coordination is automatic at startup and follows tunnel rotation by key, with bounded retries and post-relaunch confirmation.

`npm start` runs the relaunch supervisor, waits for worker prime and commit
confirmation, checks registered peers, and reports convergence only after a
peer pull/relaunch has confirmed the target commit and tunnel. Set
`MACHINE_BASE_COORDINATE_ON_START=0` to run one machine without peer
coordination. Configure `MACHINE_BASE_REPO_ROOT`,
`MACHINE_BASE_GIT_BRANCH`, and optionally the exact
`MACHINE_BASE_GIT_ORIGIN` for the checkout being synchronized.

Set `PORT=0` when the local relay service must use an OS-assigned free port. The
server waits for the actual bound port, then constructs the tunnel origin from
that port before starting `cloudflared` and publishing the URL.
