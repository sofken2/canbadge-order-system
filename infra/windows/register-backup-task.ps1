# バックアップを、数分おきに取るタスクを登録する（管理者の PowerShell から、処理PC で1回だけ）。
#
# 使い方:  .\register-backup-task.ps1 -User canbadge            （5 分おき）
#          .\register-backup-task.ps1 -User canbadge -Minutes 10
# 解除:    Unregister-ScheduledTask -TaskName canbadge-backup -Confirm:$false
#
# バックアップ先は、.env の BACKUP_DIR（処理PC とは別の物理ドライブ）。先に書いておく。
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

#Requires -RunAsAdministrator
param(
  [Parameter(Mandatory = $true)][string]$User,
  [int]$Minutes = 5
)
$ErrorActionPreference = "Stop"

$script = (Resolve-Path (Join-Path $PSScriptRoot "run-backup.ps1")).Path
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
# 登録した直後から、一定の間隔で繰り返す（PC を再起動しても、タスクは残り、繰り返しが続く）
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $Minutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
# 前回が終わっていなければ、重ねて動かさない（バックアップは同時に 1 つだけ）
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable

Register-ScheduledTask -TaskName "canbadge-backup" -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Get-ScheduledTask -TaskName "canbadge-backup" | Format-List TaskName, State
Write-Host "登録しました。$Minutes 分おきに、$User でバックアップを取ります（ログ: data\logs\backup.log）"
