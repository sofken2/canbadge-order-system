# バックアップが、ちゃんと取れているかを確かめる。当日の開始前と、途中の見回りで実行する。
#
# 使い方:  .\check-backup.ps1            （直近の成功が 15 分より古ければ、警告して異常終了）
#          .\check-backup.ps1 -MaxAgeMinutes 30
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

param([int]$MaxAgeMinutes = 15)

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Read-EnvValue([string]$name) {
  $envFile = Join-Path $repo ".env"
  if (-not (Test-Path $envFile)) { return $null }
  foreach ($line in Get-Content $envFile -Encoding UTF8) {
    if ($line -match "^\s*$name\s*=\s*(.*?)\s*$") { return $Matches[1].Trim('"').Trim([char]39) }
  }
  return $null
}

# 環境変数があればそれを使う（run-backup.ps1 と同じく、実行時の環境変数が .env より優先される）
$backupDir = $env:BACKUP_DIR
if (-not $backupDir) { $backupDir = Read-EnvValue "BACKUP_DIR" }
if (-not $backupDir) { Write-Host "NG: .env に BACKUP_DIR がありません"; exit 1 }
if (-not [System.IO.Path]::IsPathRooted($backupDir)) { $backupDir = Join-Path $repo $backupDir }
if (-not (Test-Path $backupDir)) { Write-Host "NG: バックアップ先が見つかりません（外付けドライブが外れていないか）: $backupDir"; exit 1 }

$latestFile = Join-Path $backupDir "latest.json"
if (-not (Test-Path $latestFile)) { Write-Host "NG: まだバックアップが 1 回も取れていません: $backupDir"; exit 1 }

$latest = Get-Content $latestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$age = (Get-Date).ToUniversalTime() - ([DateTime]::Parse($latest.at).ToUniversalTime())
$minutes = [Math]::Round($age.TotalMinutes, 1)
$count = (Get-ChildItem (Join-Path $backupDir "snapshots") -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike "*.partial" }).Count
$free = [Math]::Round((Get-PSDrive -Name ([System.IO.Path]::GetPathRoot($backupDir).Substring(0, 1))).Free / 1GB, 1)

Write-Host "直近のバックアップ: $($latest.snapshot)（$minutes 分前）、スナップショット $count 個、画像 $($latest.images) 件、空き容量 $free GB"
if ($minutes -gt $MaxAgeMinutes) {
  Write-Host "NG: $MaxAgeMinutes 分以上、バックアップが取れていません。data\logs\backup.log を確認してください"
  exit 1
}
Write-Host "OK"
