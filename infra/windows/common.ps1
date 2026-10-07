# 処理PC のスクリプトで共有する関数。各スクリプトから、`. (Join-Path $PSScriptRoot "common.ps1")` で読み込む。
#
# 設定の置き場（PC を替えるときは、この 2 つのファイルを持っていく。infra/moving.md）:
#   .env             開発と共通の設定（ポート・Cloudflare Access・Turnstile・Discord など）
#   .env.production  処理PC の起動（start-all）とビルドのときだけ、.env を上書きする。
#                    実プリンターで印刷する・本番の URL・バックアップ先など、「この PC を処理PC にする」設定
#                    （雛形：infra/env.production.example）。開発（bun run dev）には効かない
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

function Get-RepoRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Read-EnvFileValue([string]$file, [string]$name) {
  if (-not (Test-Path $file)) { return $null }
  foreach ($line in Get-Content $file -Encoding UTF8) {
    if ($line -match "^\s*$name\s*=\s*(.*?)\s*$") { return $Matches[1].Trim('"').Trim([char]39) }
  }
  return $null
}

# 処理PC としての値。.env.production → .env の順に探す（.env.production が優先）
function Read-EnvValue([string]$name, [string]$repo = (Get-RepoRoot)) {
  $value = Read-EnvFileValue (Join-Path $repo ".env.production") $name
  if ($null -ne $value -and $value -ne "") { return $value }
  return Read-EnvFileValue (Join-Path $repo ".env") $name
}

# bun に渡す --env-file の並び。後のものが先のものを上書きする
function Get-BunEnvArgs([string]$repo = (Get-RepoRoot)) {
  $args = @("--env-file=.env.example")
  if (Test-Path (Join-Path $repo ".env")) { $args += "--env-file=.env" }
  if (Test-Path (Join-Path $repo ".env.production")) { $args += "--env-file=.env.production" }
  return $args
}

function Test-IsAdmin {
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# 電源プランの、AC 接続時の値（秒）を返す。例：Get-AcSeconds SUB_SLEEP STANDBYIDLE。読めなければ $null
# （日本語・英語のどちらの Windows でも、「... AC ... 0x00000e10」の形の行を読む）
function Get-AcSeconds([string]$subgroup, [string]$setting) {
  $out = powercfg /query SCHEME_CURRENT $subgroup $setting 2>$null
  foreach ($line in $out) {
    if ($line -match "AC.*?0x([0-9a-fA-F]+)") { return [Convert]::ToInt32($Matches[1], 16) }
  }
  return $null
}

# 電源設定を変える前の値の保存先。リポジトリの外（PC を替えても、リポジトリを消しても、影響しない）
function Get-PowerBackupPath {
  return (Join-Path $env:ProgramData "canbadge\power-before.json")
}
