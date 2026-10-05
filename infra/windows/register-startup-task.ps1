# ログオン時に start-all.ps1 を実行するタスクを登録する（管理者の PowerShell から、処理PC で1回だけ）。
#
# 使い方:  .\register-startup-task.ps1 -User canbadge
# 解除:    Unregister-ScheduledTask -TaskName canbadge-start-all -Confirm:$false
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

#Requires -RunAsAdministrator
param(
  # 自動ログオンする専用ユーザー
  [Parameter(Mandatory = $true)][string]$User
)
$ErrorActionPreference = "Stop"

$script = (Resolve-Path (Join-Path $PSScriptRoot "start-all.ps1")).Path
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
# 管理者権限は要らない（通常のユーザーで動かす）。時間制限なし、電池でも動かす、二重起動しない
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName "canbadge-start-all" -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Get-ScheduledTask -TaskName "canbadge-start-all" | Format-List TaskName, State
Write-Host "登録しました。$User でログオンすると、start-all.ps1 が動きます"
