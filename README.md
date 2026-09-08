# Machine-base server

Standalone Node.js service for a loopback HTTP API, supervised Codex worker
pair, and rotating Cloudflare quick tunnel.

## Run

```powershell
npm test
$env:TUNNEL_RELAY_LOCAL_URL = "http://127.0.0.1:3100"
$env:CODEX_BIN = "$env:APPDATA\npm\codex.cmd"
$env:TICKETS_PROJECT_KEY = "<this-machine-project-key>"
$env:MACHINE_BASE_RUNTIME_CWD = "<this-machine-project-root>"
npm start
```

The project key and runtime cwd are explicit per-machine configuration; the
server does not infer a host role from filesystem paths.

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
`POST /api/machine-base/peer-request-send` unless explicitly disabled.

To ping another machine by its exact registry key:

```powershell
Invoke-RestMethod http://127.0.0.1:3100/api/machine-base/peer-ping -Method Post -ContentType 'application/json' -Body '{"tunnelKey":"machine-base-..."}'
```

The server resolves the current peer URL through the Wix `tunnels` endpoint and
contacts only its validated HTTPS quick-tunnel URL.

Remote prompts are bounded and route only by an exact peer key. Set
`MACHINE_BASE_REMOTE_PROMPTS_ENABLED=0` to disable the receiving route and set
`MACHINE_BASE_PEER_REQUEST_SENDER_ENABLED=0` to disable the sender operation.
The existing general worker route remains disabled unless
`MACHINE_BASE_LOCAL_WORKER_REQUEST_ENABLED=1` is explicitly set.

The sender treats the initial peer request as `202 accepted`, then persistently
polls `/api/machine-base/peer-request-status` by request ID until a terminal
result or explicit cancellation, including fresh exact-key lookup on each poll
so tunnel rotation is tolerated. Transport requests have bounded connection
attempts; remote processing has no encoded time limit.

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
