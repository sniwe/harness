$ErrorActionPreference = 'Stop'
$env:MACHINE_BASE_REPO_ROOT = 'C:\harness'
$env:MACHINE_BASE_RUNTIME_CWD = 'C:\Users\rhyse\Qwen3-ASR'
$env:TICKETS_BASE_URL = 'https://dev-sitex2082572611.wixdev-sites.org'
$env:TICKETS_PROJECT_KEY = 'qwen-asr'
$env:TICKETS_LOG_ROOT = 'C:\trendbase\mgmt\logs'
$env:TICKETS_ENABLED = $env:TICKETS_ENABLED ?? '0'
$env:TICKETS_WORKER_ENABLED = $env:TICKETS_WORKER_ENABLED ?? '0'
Set-Location $PSScriptRoot\..
& node src\launcher.js
exit $LASTEXITCODE
