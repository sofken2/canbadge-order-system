# 処理PC の電源・画面ロック・自動再起動の設定を、1回でまとめて行う（管理者の PowerShell から）。
# 本番の処理PC でだけ実行する。開発用のPC で実行すると、スリープしなくなり、ロックされなくなる。
#
# 行うこと:
#   - スリープ・休止・ディスクの停止・画面オフを無効にする（電源につないでいる間）
#   - ロック画面を出さない
#   - ログオン中の自動再起動（Windows Update）をしない
# 行わないこと（手作業。infra/processing-pc.md に手順）:
#   - 専用ユーザーの作成、自動ログオン（パスワードを扱うので、Autologon を使う）
#   - Windows Update の一時停止（設定アプリから）、BIOS の設定
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

function Set-Policy([string]$path, [string]$name, [int]$value) {
  if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
  New-ItemProperty -Path $path -Name $name -Value $value -PropertyType DWord -Force | Out-Null
  Write-Host "設定: $path  $name = $value"
}

# 変更する前の値を保存する（restore-power-settings.ps1 が、元に戻すのに使う）。
# すでに保存してあれば、上書きしない（2 回目以降は、変更後の値を、元の値と取り違えるため）
$backupPath = Get-PowerBackupPath
if (-not (Test-Path $backupPath)) {
  $policies = @(
    @{ Path = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization"; Name = "NoLockScreen" },
    @{ Path = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"; Name = "InactivityTimeoutSecs" },
    @{ Path = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU"; Name = "NoAutoRebootWithLoggedOnUsers" }
  ) | ForEach-Object {
    $item = Get-ItemProperty -Path $_.Path -Name $_.Name -ErrorAction SilentlyContinue
    @{ Path = $_.Path; Name = $_.Name; Existed = ($null -ne $item); Value = $(if ($null -ne $item) { [int]$item.($_.Name) } else { $null }) }
  }
  $hibernate = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Power" -Name "HibernateEnabled" -ErrorAction SilentlyContinue
  $before = @{
    SavedAt = (Get-Date).ToString("s")
    StandbySeconds = (Get-AcSeconds "SUB_SLEEP" "STANDBYIDLE")
    HibernateSeconds = (Get-AcSeconds "SUB_SLEEP" "HIBERNATEIDLE")
    MonitorSeconds = (Get-AcSeconds "SUB_VIDEO" "VIDEOIDLE")
    DiskSeconds = (Get-AcSeconds "SUB_DISK" "DISKIDLE")
    HibernateEnabled = $(if ($null -ne $hibernate) { [int]$hibernate.HibernateEnabled } else { $null })
    Policies = @($policies)
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $backupPath) | Out-Null
  $before | ConvertTo-Json -Depth 5 | Set-Content -Path $backupPath -Encoding UTF8
  Write-Host "変更前の値を保存しました: $backupPath（元に戻すとき: restore-power-settings.ps1）"
}

# 電源（AC 接続時）。画面もオフにしない（呼び出しモニターを出し続けるため）
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change disk-timeout-ac 0
powercfg /hibernate off
Write-Host "電源: スリープ・休止・画面オフ・ディスク停止を無効にしました"

# ロック画面を出さない（再起動後の自動ログオンを、ロック画面で止めないため）
Set-Policy "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization" "NoLockScreen" 1
# 無操作での画面ロックをしない
Set-Policy "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" "InactivityTimeoutSecs" 0

# ユーザーがログオンしている間は、Windows Update で自動再起動しない
Set-Policy "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" "NoAutoRebootWithLoggedOnUsers" 1

Write-Host ""
Write-Host "完了。残りの手作業は infra/processing-pc.md を見てください（自動ログオン・Windows Update の一時停止・BIOS）"
