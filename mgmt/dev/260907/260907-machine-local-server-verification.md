# Machine-local server verification

Date: 2026-09-07  
Workspace: `C:\harness`

## Focused automated proof

Command:

```text
npm test
```

Result: 8 tests passed, 1 platform-specific Linux identity test skipped on this
Windows host.

Covered behavior:

- stable machine identity derivation and generic-value fallback;
- cross-platform identity source selection (Linux case is skipped on Windows);
- atomic setup manifest reuse and stale-lock recovery;
- tunnel URL extraction/publication from stdout and stderr;
- URL rotation and healthy-process relaunch;
- serialized relay publication so a newer URL cannot be overwritten by an older
  in-flight POST;
- active/standby worker readiness and JSONL request response;
- controlled active-worker failure, peer failover, and repair.

## Real local runtime proof

Using `MACHINE_BASE_FAKE=1` for the worker only, the server started two worker
children and served local `/health`, `/status`, and
`POST /api/machine-base/request`. The repeated startup reused:

```text
tunnelKey = machine-base-73182d23f660c3880e7e
setupAttemptId = b67beb4a-8dda-47e0-8f3d-001eba6df77c
```

The second value remained unchanged across restart, proving manifest reuse.

## Real Codex proof

Installed CLI:

```text
codex-cli 0.153.4
```

`node mgmt/machine-base-worker/src/index.js --file test/payload.json` started a
real Codex app-server, initialized a thread, completed the startup `test` turn,
returned a completed response, and exited with code 0.

## Real tunnel and public-path proof

With the installed `cloudflared` and a local relay fixture:

1. `cloudflared` produced a live `trycloudflare.com` URL.
2. The relay fixture stored that URL under the derived machine key.
3. The public tunnel returned HTTP success for `/health`.
4. The public tunnel returned a successful worker response for
   `POST /api/machine-base/request`.

The URL was ephemeral and is intentionally not treated as a durable endpoint.
All test server, worker, cloudflared, and relay processes were stopped; the
final process scan found no matching `C:\harness` descendants.

An isolated direct `cloudflared` run was also verified independently: the issued
hostname resolved A/AAAA records and served the loopback `/health` response over
HTTPS. This proves the installed tunnel binary and local ingress path work.

## Provisional Wix endpoint check

Using the existing documented Wix relay and the derived machine key, the actual
relay POST returned success and the server logged publication of the current
quick-tunnel URL. A bounded two-minute public probe then failed DNS resolution for
that Wix-run hostname. Therefore real Wix relay acceptance is proven, but public
reachability through that specific ephemeral URL is not claimed from this run.
The local relay fixture/public-path proof and the independent direct tunnel probe
remain successful.

## Remaining production gate

The user-provided always-online endpoint details were not present in the request.
Production relay authentication, exact lookup/preflight behavior, key length
rules, and the final machine-base task contract remain unverified. Configure and
re-run the public-path proof against that exact endpoint before deployment.

## New-machine default configuration proof

With `TUNNEL_RELAY_BASE_URL`, `TUNNEL_RELAY_PATH`, and
`TUNNEL_RELAY_LOCAL_URL` absent, the server used the documented Wix relay
defaults and resolved the installed `cloudflared` from `PATH`. The real run
published a URL under the derived machine key; local `/health`, public `/health`,
and the public worker request all returned success. This closes the original
new-machine failure where `tunnel` was incorrectly reported as `null` when no
environment configuration was supplied.

## Dynamic local-port proof

With `PORT=0` and a local relay fixture, the operating system assigned port
`55872`. The server constructed its local origin from that bound port before
starting `cloudflared`; the relay received the resulting URL, and both local and
public `/health` requests returned success. This verifies that a dynamically
determined relay origin is propagated through the tunnel path.
