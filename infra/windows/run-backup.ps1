# バックアップを 1 回取る。タスクスケジューラが、数分おきに呼ぶ（register-backup-task.ps1）。
# 結果は data\logs\backup.log に追記する。手で試すときも、これを実行する。
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

$logDir = Join-Path $repo "data\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "backup.log"
# ログが大きくなりすぎないよう、大きければ退避する
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) { Move-Item $log "$log.old" -Force }

$bun = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bun) {
  "$((Get-Date).ToString('s')) bun が見つかりません" | Add-Content -Path $log -Encoding UTF8
  exit 1
}

$envArgs = @("--env-file=.env.example")
if (Test-Path (Join-Path $repo ".env")) { $envArgs += "--env-file=.env" }

# 標準出力と標準エラーの両方を、ログに追記する
& $bun.Source @envArgs "packages/db/src/backup-cli.ts" *>&1 | ForEach-Object { "$_" } | Add-Content -Path $log -Encoding UTF8
exit $LASTEXITCODE
