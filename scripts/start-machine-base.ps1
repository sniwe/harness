$ErrorActionPreference = 'Stop'
$env:MACHINE_BASE_REPO_ROOT = 'C:\harness'
$env:TICKETS_LOG_ROOT = 'C:\trendbase\mgmt\logs'
$env:TICKETS_ENABLED = $env:TICKETS_ENABLED ?? '0'
$env:TICKETS_WORKER_ENABLED = $env:TICKETS_WORKER_ENABLED ?? '0'
Set-Location $PSScriptRoot\..
& node src\launcher.js
exit $LASTEXITCODE
