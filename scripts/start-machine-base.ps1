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
$env:TICKETS_ENABLED = '1'
$env:TICKETS_WORKER_ENABLED = '1'
Set-Location $harnessRoot
$delaySeconds = 1
while ($true) {
  if ($env:MACHINE_BASE_MAINTENANCE -eq '1') { exit 0 }
  & node src\launcher.js
  $exitCode = $LASTEXITCODE
  if ($env:MACHINE_BASE_MAINTENANCE -eq '1') { exit $exitCode }
  Start-Sleep -Seconds $delaySeconds
  $delaySeconds = [Math]::Min(60, $delaySeconds * 2)
}
