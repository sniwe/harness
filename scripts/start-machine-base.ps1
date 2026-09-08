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
$dataRoot = if ([string]::IsNullOrWhiteSpace($env:MACHINE_BASE_DATA_ROOT)) { Join-Path $harnessRoot 'data\machine-base' } else { [System.IO.Path]::GetFullPath($env:MACHINE_BASE_DATA_ROOT) }
New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
$lockPath = Join-Path $dataRoot 'startup.lock'
try { $lock = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None) } catch { throw 'machine_base_singleton_already_running' }
$delaySeconds = 1
try {
  while ($true) {
    if ($env:MACHINE_BASE_MAINTENANCE -eq '1') { exit 0 }
    & node src\launcher.js
    $exitCode = $LASTEXITCODE
    if ($env:MACHINE_BASE_MAINTENANCE -eq '1') { exit $exitCode }
    Start-Sleep -Seconds $delaySeconds
    $delaySeconds = [Math]::Min(60, $delaySeconds * 2)
  }
} finally {
  $lock.Dispose()
}
