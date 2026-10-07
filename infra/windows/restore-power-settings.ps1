# configure-processing-pc.ps1 で変えた、電源・画面ロック・自動再起動の設定を、変える前の値に戻す
# （管理者の PowerShell から）。処理PC をやめて、普通の PC に戻すとき・開発に戻すときに使う。
#
# 戻す元は、configure-processing-pc.ps1 が、変える前に保存した値（%ProgramData%\canbadge\power-before.json）。
# 保存がなければ（configure を実行していなければ）、何もしない。
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$backupPath = Get-PowerBackupPath
if (-not (Test-Path $backupPath)) {
  Write-Host "保存された元の値がありません（$backupPath）。configure-processing-pc.ps1 を実行していないなら、戻すものはありません"
  exit 0
}
$before = Get-Content $backupPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Restore-Timeout([string]$command, $seconds) {
  if ($null -eq $seconds) { return }
  powercfg /change $command ([int]($seconds / 60))
  Write-Host "戻した: $command = $([int]($seconds / 60)) 分"
}
Restore-Timeout "standby-timeout-ac" $before.StandbySeconds
Restore-Timeout "hibernate-timeout-ac" $before.HibernateSeconds
Restore-Timeout "monitor-timeout-ac" $before.MonitorSeconds
Restore-Timeout "disk-timeout-ac" $before.DiskSeconds
if ($before.HibernateEnabled -eq 1) { powercfg /hibernate on; Write-Host "戻した: 休止状態 = 有効" }

foreach ($p in $before.Policies) {
  if ($p.Existed) {
    New-ItemProperty -Path $p.Path -Name $p.Name -Value ([int]$p.Value) -PropertyType DWord -Force | Out-Null
    Write-Host "戻した: $($p.Path)  $($p.Name) = $($p.Value)"
  } else {
    Remove-ItemProperty -Path $p.Path -Name $p.Name -ErrorAction SilentlyContinue
    Write-Host "削除した（もとは、なかった）: $($p.Path)  $($p.Name)"
  }
}

Move-Item $backupPath "$backupPath.restored-$((Get-Date).ToString('yyyyMMdd-HHmmss'))" -Force
Write-Host ""
Write-Host "完了。自動ログオン（Autologon）を使っていたなら、そちらは別に解除してください（infra/processing-pc.md 手順 6）"
