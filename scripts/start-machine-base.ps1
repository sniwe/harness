param(
  [string]$ProjectKey = $env:TICKETS_PROJECT_KEY,
  [string]$RuntimeCwd = $env:MACHINE_BASE_RUNTIME_CWD,
  [string]$TicketsBaseUrl = $env:TICKETS_BASE_URL,
  [string]$LogRoot = $env:TICKETS_LOG_ROOT
)

$ErrorActionPreference = 'Stop'
$harnessRoot = Split-Path -Parent $PSScriptRoot
$env:MACHINE_BASE_REPO_ROOT = $harnessRoot
if ([string]::IsNullOrWhiteSpace($ProjectKey) -or [string]::IsNullOrWhiteSpace($RuntimeCwd)) { throw 'project_key_and_runtime_cwd_required' }
$env:TICKETS_PROJECT_KEY = $ProjectKey
$env:MACHINE_BASE_RUNTIME_CWD = $RuntimeCwd
if (-not [string]::IsNullOrWhiteSpace($TicketsBaseUrl)) { $env:TICKETS_BASE_URL = $TicketsBaseUrl }
if (-not [string]::IsNullOrWhiteSpace($LogRoot)) { $env:TICKETS_LOG_ROOT = $LogRoot }
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
