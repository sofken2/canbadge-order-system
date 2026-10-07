# この PC の「処理PC としての中身」を、まとめて持ち出す（PC を替えるとき、古い PC で実行する）。
# 持ち出すもの：
#   - .env と .env.production（Cloudflare Access・Turnstile・Discord の秘密を含む）
#   - Cloudflare のトンネルの認証（%USERPROFILE%\.cloudflared。config.yml・認証ファイル・cert.pem）
#   - データの最新のバックアップ（DB・画像。注文のデータ）
#   - どの状態から持ち出したかの記録（manifest.json）
#
# 使い方:  .\export-processing-pc.ps1 -To E:\          （USB メモリ・外付けドライブ。E:\canbadge-move\ ができる）
#          .\export-processing-pc.ps1 -To E:\ -RetireThisPc   （持ち出したあと、この PC のトンネルと起動を止める。管理者）
#
# 秘密が入っているので、持ち出し先は、人に渡らない USB に限り、新しい PC に入れたら、消す。クラウド・メールに置かない。
# トンネルは、2 台の PC が、同時につなぐと、注文が 2 台に分かれる。-RetireThisPc で、この PC を止める（新しい PC に、つなぐ前に）。
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

param(
  [Parameter(Mandatory = $true)][string]$To,
  [switch]$RetireThisPc
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
$repo = Get-RepoRoot

if (-not (Test-Path $To)) { throw "$To が見つかりません（USB メモリ・外付けドライブを、つないでください）" }
$dest = Join-Path (Resolve-Path $To).Path "canbadge-move"
# リポジトリの中には、出さない（誤って、コミットされないように）
if ($dest.StartsWith($repo, [System.StringComparison]::OrdinalIgnoreCase)) { throw "持ち出し先が、リポジトリの中です。USB メモリなど、外を指定してください" }
if (Test-Path $dest) {
  $old = "$dest.old-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
  Rename-Item $dest $old
  Write-Host "前回の持ち出しを、退避しました: $old（不要なら、消してください。秘密が入っています）"
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Write-Host "持ち出し先: $dest" -ForegroundColor Cyan

# 1. 設定
foreach ($f in @(".env", ".env.production")) {
  $p = Join-Path $repo $f
  if (Test-Path $p) { Copy-Item $p (Join-Path $dest $f); Write-Host "コピー: $f" } else { Write-Host "ない（飛ばす）: $f" -ForegroundColor Yellow }
}

# 2. トンネルの認証
$cf = Join-Path $env:USERPROFILE ".cloudflared"
if (Test-Path $cf) {
  $cfDest = Join-Path $dest "cloudflared"
  New-Item -ItemType Directory -Force -Path $cfDest | Out-Null
  Get-ChildItem $cf -File | Where-Object { $_.Name -in @("config.yml", "cert.pem") -or $_.Extension -eq ".json" } | ForEach-Object {
    Copy-Item $_.FullName $cfDest; Write-Host "コピー: cloudflared\$($_.Name)"
  }
} else { Write-Host "ない（飛ばす）: $cf" -ForegroundColor Yellow }

# 3. データ（DB・画像）の、いまの状態を、バックアップとして取る。動いている DB を、そのままコピーしない（VACUUM INTO で、整合性のあるコピーを作る）
$bun = Get-Command bun -ErrorAction SilentlyContinue
$dataDir = Join-Path $repo "data"
if ($bun -and (Test-Path (Join-Path $dataDir "app.db"))) {
  $backupDest = Join-Path $dest "backup"
  $previous = $env:BACKUP_DIR
  $env:BACKUP_DIR = $backupDest
  try {
    Push-Location $repo
    & $bun.Source (Get-BunEnvArgs $repo) "packages/db/src/backup-cli.ts"
    if ($LASTEXITCODE -ne 0) { throw "バックアップに失敗しました" }
  } finally { Pop-Location; $env:BACKUP_DIR = $previous }
  Write-Host "バックアップ: backup\"
} else { Write-Host "データがない（または bun がない）ので、バックアップは取りませんでした" -ForegroundColor Yellow }

# 4. 記録
$commit = (git -C $repo rev-parse --short HEAD 2>$null)
$branch = (git -C $repo rev-parse --abbrev-ref HEAD 2>$null)
@{
  ExportedAt = (Get-Date).ToString("s")
  FromComputer = $env:COMPUTERNAME
  GitCommit = $commit
  GitBranch = $branch
  PrinterName = (Read-EnvValue "PRINTER_NAME" $repo)
  BackupDir = (Read-EnvValue "BACKUP_DIR" $repo)
} | ConvertTo-Json | Set-Content -Path (Join-Path $dest "manifest.json") -Encoding UTF8

@"
このフォルダは、処理PC の「中身」です。秘密情報（Cloudflare・Turnstile・Discord）が入っています。
新しい PC に入れたら、このフォルダを消してください。クラウド・メール・チャットに置かないでください。

新しい PC での手順（infra/moving.md）:
  1. git clone してリポジトリを取得（コミット $commit と同じか、新しいもの）
  2. .\infra\windows\import-processing-pc.ps1 -From <このフォルダ>
  3. .env.production の PRINTER_NAME・BACKUP_DIR を、新しい PC に合わせて直す
  4. 管理者の PowerShell で .\infra\windows\setup-processing-pc.ps1（そのあと、-Tunnel）
  5. .\infra\windows\check-processing-pc.ps1 -Public
"@ | Set-Content -Path (Join-Path $dest "README.txt") -Encoding UTF8

Write-Host ""
Write-Host "持ち出しました: $dest" -ForegroundColor Green

# 5. この PC を止める（指定したときだけ）
if ($RetireThisPc) {
  if (-not (Test-IsAdmin)) { throw "-RetireThisPc は、管理者の PowerShell が必要です" }
  Write-Host ""
  Write-Host "この PC を止めます（トンネル・自動起動）" -ForegroundColor Cyan
  & (Join-Path $PSScriptRoot "stop-all.ps1")
  $svc = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
  if ($svc) {
    if ($svc.Status -ne "Stopped") { Stop-Service -Name "Cloudflared" -Force }
    Set-Service -Name "Cloudflared" -StartupType Disabled
    Write-Host "Cloudflared サービスを止めて、自動起動を無効にしました（戻す：Set-Service Cloudflared -StartupType Automatic; Start-Service Cloudflared）"
  }
  foreach ($task in @("canbadge-start-all", "canbadge-backup")) {
    if (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue) { Disable-ScheduledTask -TaskName $task | Out-Null; Write-Host "タスクを無効にしました: $task" }
  }
  Write-Host "この PC は、もう、来場者の通信を受けません。新しい PC で、トンネルをつないでください" -ForegroundColor Green
}
