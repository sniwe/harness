$ErrorActionPreference = 'Stop'
$harnessRoot = Split-Path -Parent $PSScriptRoot
$env:MACHINE_BASE_REPO_ROOT = $harnessRoot
$env:TICKETS_BASE_URL = 'https://dev-sitex2082572611.wixdev-sites.org'
$peerHost = Test-Path 'C:\Users\Qub\harness'
if ($peerHost) {
  $env:MACHINE_BASE_RUNTIME_CWD = 'C:\retry'
  $env:TICKETS_PROJECT_KEY = 'main-app'
} else {
  $env:MACHINE_BASE_RUNTIME_CWD = 'C:\Users\rhyse\Qwen3-ASR'
  $env:TICKETS_PROJECT_KEY = 'qwen-asr'
}
$env:TICKETS_LOG_ROOT = 'C:\trendbase\mgmt\logs'
$env:TICKETS_ENABLED = $env:TICKETS_ENABLED ?? '0'
$env:TICKETS_WORKER_ENABLED = $env:TICKETS_WORKER_ENABLED ?? '0'
Set-Location $harnessRoot
& node src\launcher.js
exit $LASTEXITCODE
