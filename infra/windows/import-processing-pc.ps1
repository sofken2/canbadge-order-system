# export-processing-pc.ps1 で持ち出したものを、新しい PC に入れる（新しい PC で、リポジトリを取得したあとに実行する）。
# 入れるもの：.env・.env.production・Cloudflare のトンネルの認証・データ（DB・画像）。
# そのあと、.env.production の PRINTER_NAME・BACKUP_DIR を、新しい PC に合わせて直す（このスクリプトが、直す箇所を教える）。
#
# 使い方:  .\import-processing-pc.ps1 -From E:\canbadge-move
#          .\import-processing-pc.ps1 -From E:\canbadge-move -Force   （すでにある .env などを、退避して、置き換える）
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

param(
  [Parameter(Mandatory = $true)][string]$From,
  [switch]$Force
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
$repo = Get-RepoRoot

if (-not (Test-Path (Join-Path $From "manifest.json"))) { throw "$From に manifest.json がありません（export-processing-pc.ps1 が作ったフォルダを、指定してください）" }
$manifest = Get-Content (Join-Path $From "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "持ち出し元: $($manifest.FromComputer)  $($manifest.ExportedAt)  コミット $($manifest.GitCommit)（$($manifest.GitBranch)）" -ForegroundColor Cyan

$localCommit = (git -C $repo rev-parse --short HEAD 2>$null)
if ($manifest.GitCommit -and $localCommit -and $manifest.GitCommit -ne $localCommit) {
  # 持ち出し元より古いコードだと、データの形（DB）が合わないことがある
  git -C $repo merge-base --is-ancestor $manifest.GitCommit HEAD 2>$null
  $contains = ($LASTEXITCODE -eq 0)
  if (-not $contains) { Write-Host "注意: このリポジトリ（$localCommit）は、持ち出し元のコミット（$($manifest.GitCommit)）を含んでいません。git pull で、新しくしてください" -ForegroundColor Yellow }
}

function Place([string]$source, [string]$target) {
  if (Test-Path $target) {
    if (-not $Force) { Write-Host "すでにある（飛ばす。置き換えるなら -Force）: $target" -ForegroundColor Yellow; return }
    $backup = "$target.bak-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
    Move-Item $target $backup
    Write-Host "退避: $backup"
  }
  Copy-Item $source $target
  Write-Host "入れた: $target"
}

# 1. 設定
foreach ($f in @(".env", ".env.production")) {
  $src = Join-Path $From $f
  if (Test-Path $src) { Place $src (Join-Path $repo $f) }
}

# 2. トンネルの認証。config.yml の credentials-file は、持ち出し元のユーザーの場所を指しているので、この PC の場所に書き換える
$cfSource = Join-Path $From "cloudflared"
if (Test-Path $cfSource) {
  $cfTarget = Join-Path $env:USERPROFILE ".cloudflared"
  New-Item -ItemType Directory -Force -Path $cfTarget | Out-Null
  foreach ($file in Get-ChildItem $cfSource -File) {
    $target = Join-Path $cfTarget $file.Name
    if ($file.Name -eq "config.yml") {
      if ((Test-Path $target) -and -not $Force) { Write-Host "すでにある（飛ばす。置き換えるなら -Force）: $target" -ForegroundColor Yellow; continue }
      if (Test-Path $target) { Move-Item $target "$target.bak-$((Get-Date).ToString('yyyyMMdd-HHmmss'))" }
      $lines = Get-Content $file.FullName -Encoding UTF8 | ForEach-Object {
        if ($_ -match "^\s*credentials-file:\s*(.+)$") { "credentials-file: " + (Join-Path $cfTarget (Split-Path $Matches[1].Trim() -Leaf)) } else { $_ }
      }
      Set-Content -Path $target -Value $lines -Encoding UTF8
      Write-Host "入れた（credentials-file を、この PC の場所に書き換え）: $target"
    } else { Place $file.FullName $target }
  }
}

# 3. データ（DB・画像）
$backupSource = Join-Path $From "backup"
$dbPath = Join-Path $repo "data\app.db"
if (Test-Path $backupSource) {
  if (Test-Path $dbPath) {
    Write-Host "データ: すでに data\app.db があるので、復旧しません。置き換えるなら、api を止めて： bun run restore `"$backupSource`" --force" -ForegroundColor Yellow
  } else {
    $bun = Get-Command bun -ErrorAction SilentlyContinue
    if (-not $bun) { Write-Host "データ: bun がないので、復旧できません。bun を入れてから： bun run restore `"$backupSource`"" -ForegroundColor Yellow }
    else {
      Push-Location $repo
      try { & $bun.Source (Get-BunEnvArgs $repo) "packages/db/src/restore-cli.ts" $backupSource; if ($LASTEXITCODE -ne 0) { throw "データの復旧に失敗しました" } } finally { Pop-Location }
      Write-Host "データを復旧しました（data\）"
    }
  }
}

# 4. この PC に合わせて直す箇所を、教える
Write-Host ""
Write-Host "この PC に合わせて、直すもの（.env.production）" -ForegroundColor Cyan
$printerName = Read-EnvValue "PRINTER_NAME" $repo
$printers = @(Get-Printer -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
if ($printerName -and ($printers -contains $printerName)) { Write-Host "  PRINTER_NAME: $printerName はこの PC にある（このままでよい）" -ForegroundColor Green }
else {
  Write-Host "  PRINTER_NAME: '$printerName' は、この PC にない。この PC のプリンター：" -ForegroundColor Yellow
  if ($printers.Count -eq 0) { Write-Host "    （なし。プリンターを追加してください）" } else { $printers | ForEach-Object { Write-Host "    $_" } }
}
$backupDir = Read-EnvValue "BACKUP_DIR" $repo
$root = if ($backupDir) { [System.IO.Path]::GetPathRoot($backupDir) } else { $null }
if ($backupDir -and $root -and (Test-Path $root)) { Write-Host "  BACKUP_DIR: $backupDir（このドライブは、ある。別の物理ドライブかは、check-processing-pc.ps1 が見る）" -ForegroundColor Green }
else { Write-Host "  BACKUP_DIR: '$backupDir' は、この PC では、使えない。外付けドライブのパスに、直す" -ForegroundColor Yellow }

Write-Host ""
Write-Host "次: 管理者の PowerShell で  .\infra\windows\setup-processing-pc.ps1   （そのあと、古い PC を止めてから -Tunnel）"
Write-Host "持ち出したフォルダ（$From）は、秘密が入っているので、済んだら、消してください" -ForegroundColor Yellow
