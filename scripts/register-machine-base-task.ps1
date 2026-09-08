param([string]$TaskName = 'CodexMachineBaseTickets', [switch]$Start)

$ErrorActionPreference = 'Stop'
$harnessRoot = Split-Path -Parent $PSScriptRoot
$wrapperPath = Join-Path $harnessRoot 'scripts\start-machine-base.ps1'
if (-not (Test-Path -LiteralPath $wrapperPath)) { throw 'machine_base_wrapper_missing' }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $wrapperPath) -WorkingDirectory $harnessRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ("{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Supervises the existing machine-base launcher and ticket reconciler' -Force -ErrorAction Stop | Out-Null
if ($Start) { Start-ScheduledTask -TaskName $TaskName }
Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
