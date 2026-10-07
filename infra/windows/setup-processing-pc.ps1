# この PC を、処理PC にする（管理者の PowerShell から、リポジトリで 1 回）。
# PC を替えたときは、リポジトリを取得して、.env と .env.production を置いたあと（import-processing-pc.ps1）、これを実行する。
# 何度実行しても安全（登録済みのものは、上書きするだけ）。最後に check-processing-pc.ps1 で、結果を確かめる。
#
# 使い方:  .\setup-processing-pc.ps1 -DryRun              （何をするかだけを、表示する）
#          .\setup-processing-pc.ps1                       （ツール・ビルド・自動起動・バックアップ）
#          .\setup-processing-pc.ps1 -Tunnel               （上に加えて、トンネルのサービスを登録して、起動する）
#          .\setup-processing-pc.ps1 -Tunnel -ConfigurePower -StartNow
#
# 指定したときだけ行うもの（影響が大きいので、既定では行わない）:
#   -Tunnel          Cloudflare のトンネルを Windows サービスにして起動する。来場者の通信が、この PC に向く。
#                    ほかの PC が同じトンネルにつながっていると、注文が 2 台に分かれる。先に、古い PC を止めること
#   -ConfigurePower  スリープ・画面ロック・自動再起動をしない設定にする（元に戻す：restore-power-settings.ps1）
#   -StartNow        Caddy・api・print-worker を、いま起動する（指定しなければ、次のログオンで起動する）
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

#Requires -RunAsAdministrator
param(
  # 自動ログオン・タスクの実行に使うユーザー。既定は、いま、このスクリプトを実行しているユーザー
  [string]$User = $env:USERNAME,
  [int]$BackupMinutes = 5,
  [switch]$Tunnel,
  [switch]$ConfigurePower,
  [switch]$StartNow,
  [switch]$SkipTools,
  [switch]$SkipBuild,
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
$repo = Get-RepoRoot
Set-Location $repo

$script:step = 0
function Step([string]$title, [scriptblock]$action) {
  $script:step++
  Write-Host ""
  Write-Host "[$($script:step)] $title" -ForegroundColor Cyan
  if ($DryRun) { Write-Host "    （-DryRun：実行しない）" -ForegroundColor DarkGray; return }
  & $action
}

Write-Host "処理PC のセットアップ: $env:COMPUTERNAME / ユーザー $User / $repo"
if ($DryRun) { Write-Host "※ -DryRun：何も変更しません" -ForegroundColor Yellow }

# 先に、設定ファイルがあることを確かめる（なければ、途中で止まらないよう、ここで止める）
foreach ($f in @(".env", ".env.production")) {
  if (-not (Test-Path (Join-Path $repo $f))) {
    throw "$f がありません。infra\env.production.example（.env.production の雛形）と .env.example を見て、先に置いてください（PC を替えたときは import-processing-pc.ps1）"
  }
}

if (-not $SkipTools) {
  Step "ツールを入れる（git・bun・caddy・cloudflared・SumatraPDF。入っているものは飛ばす）" {
    & (Join-Path $PSScriptRoot "install-tools.ps1")
    $sumatraPath = Read-EnvValue "SUMATRA_PATH" $repo
    $hasSumatra = ($sumatraPath -and (Test-Path $sumatraPath)) -or (Get-Command "SumatraPDF" -ErrorAction SilentlyContinue) -or (Test-Path (Join-Path $env:LOCALAPPDATA "SumatraPDF\SumatraPDF.exe"))
    if ($hasSumatra) { Write-Host "済み: SumatraPDF" } else {
      Write-Host "インストール: SumatraPDF.SumatraPDF"
      winget install --id SumatraPDF.SumatraPDF -e --accept-package-agreements --accept-source-agreements
    }
    Write-Host "※ 入れたものが PATH に出ない場合は、PowerShell を開き直して、もう一度実行してください"
  }
}

if (-not $SkipBuild) {
  Step "依存関係を入れて、画面をビルドする（bun install・bun run build）" {
    $bun = Get-Command bun -ErrorAction SilentlyContinue
    if (-not $bun) { throw "bun が見つかりません。PowerShell を開き直してから、もう一度実行してください" }
    & $bun.Source install
    if ($LASTEXITCODE -ne 0) { throw "bun install に失敗しました" }
    # .env.production の VITE_ の値（本番の URL など）を、画面に埋め込む
    & $bun.Source run build
    if ($LASTEXITCODE -ne 0) { throw "bun run build に失敗しました" }
  }
}

Step "バックアップ先を用意する（BACKUP_DIR）" {
  $backupDir = Read-EnvValue "BACKUP_DIR" $repo
  if (-not $backupDir) { Write-Host "注意: BACKUP_DIR が未設定です。.env.production に書いてください"; return }
  if (-not [System.IO.Path]::IsPathRooted($backupDir)) { $backupDir = Join-Path $repo $backupDir }
  $root = [System.IO.Path]::GetPathRoot($backupDir)
  if (-not (Test-Path $root)) { Write-Host "注意: $root が見つかりません（外付けドライブを、つないでください）。$backupDir は、作りませんでした"; return }
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Write-Host "バックアップ先: $backupDir"
}

Step "自動起動を登録する（ログオン時に Caddy・api・print-worker を起動／バックアップを $BackupMinutes 分おき）" {
  & (Join-Path $PSScriptRoot "register-startup-task.ps1") -User $User
  & (Join-Path $PSScriptRoot "register-backup-task.ps1") -User $User -Minutes $BackupMinutes
}

if ($Tunnel) {
  Step "トンネル（Cloudflare）を Windows サービスにして、起動する" {
    $config = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
    if (-not (Test-Path $config)) { throw "$config がありません。import-processing-pc.ps1 か infra/README.md の 4-1 を先に済ませてください" }
    & (Join-Path $PSScriptRoot "install-cloudflared-service.ps1")
  }
} else {
  Write-Host ""
  Write-Host "※ トンネルは、登録していません（来場者の通信は、まだ、この PC に向きません）。登録するとき： .\infra\windows\setup-processing-pc.ps1 -Tunnel" -ForegroundColor Yellow
}

if ($ConfigurePower) {
  Step "電源・画面ロック・自動再起動を、処理PC の設定にする" {
    & (Join-Path $PSScriptRoot "configure-processing-pc.ps1")
  }
} else {
  Write-Host "※ 電源・画面ロックは、変えていません（当日の直前に： -ConfigurePower。元に戻す： restore-power-settings.ps1）" -ForegroundColor Yellow
}

if ($StartNow) {
  Step "Caddy・api・print-worker を、いま起動する" {
    $mutexHeld = $false
    $p = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", (Join-Path $PSScriptRoot "start-all.ps1") -WindowStyle Hidden -PassThru
    Write-Host "start-all.ps1 を起動しました（PID $($p.Id)）。止めるとき： .\infra\windows\stop-all.ps1"
    Start-Sleep -Seconds 12
  }
}

Write-Host ""
Write-Host "確認: check-processing-pc.ps1" -ForegroundColor Cyan
if ($DryRun) { Write-Host "    （-DryRun：実行しない）" -ForegroundColor DarkGray } else { & (Join-Path $PSScriptRoot "check-processing-pc.ps1") }
