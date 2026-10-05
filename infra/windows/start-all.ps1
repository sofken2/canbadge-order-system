# 処理PC の全プロセス（Caddy・api・print-worker）を起動し、落ちたら再起動し続ける。
# ログオン時にタスクスケジューラから呼ばれる（register-startup-task.ps1 が登録する）。
# 手動で試すときは、PowerShell から実行して、止めるときは stop-all.ps1。
#
# cloudflared は、別の Windows サービス（install-cloudflared-service.ps1）なので、ここでは扱わない。
# web・staff の画面は、ビルドした静的ファイルを Caddy が配信する（I02）。
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

$ErrorActionPreference = "Stop"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

# 二重起動を防ぐ（ログオンのたびに、前のものが残っていても増えないように）
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\canbadge-start-all", [ref]$createdNew)
if (-not $createdNew) { Write-Host "すでに start-all が動いています"; exit 0 }

$logDir = Join-Path $repo "data\logs"
$runDir = Join-Path $repo "data\run"
New-Item -ItemType Directory -Force -Path $logDir, $runDir | Out-Null

# Caddy は .env を読まないので、必要な値だけをここで取り出す
function Read-EnvValue([string]$name) {
  $envFile = Join-Path $repo ".env"
  if (-not (Test-Path $envFile)) { return $null }
  foreach ($line in Get-Content $envFile -Encoding UTF8) {
    if ($line -match "^\s*$name\s*=\s*(.*?)\s*$") { return $Matches[1].Trim('"').Trim([char]39) }
  }
  return $null
}
$staffHost = Read-EnvValue "STAFF_HOST"
if ($staffHost) { $env:STAFF_HOST = $staffHost }
$caddyPort = Read-EnvValue "CADDY_PORT"
if ($caddyPort) { $env:CADDY_PORT = $caddyPort }

function Resolve-Tool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "$name が見つかりません。infra/processing-pc.md の手順 3 を確認してください" }
  return $cmd.Source
}

# 開発時の `bun run dev` と同じく、.env.example を土台に .env で上書きする
$bunEnv = @("--env-file=.env.example")
if (Test-Path (Join-Path $repo ".env")) { $bunEnv += "--env-file=.env" }

$bun = Resolve-Tool "bun"
$caddy = Resolve-Tool "caddy"

$specs = @(
  @{ Name = "caddy"; File = $caddy; Args = @("run", "--config", "Caddyfile", "--adapter", "caddyfile"); Dir = (Join-Path $repo "infra\caddy") },
  @{ Name = "api"; File = $bun; Args = $bunEnv + @("apps/api/src/index.ts"); Dir = $repo },
  @{ Name = "print-worker"; File = $bun; Args = $bunEnv + @("apps/print-worker/src/index.ts"); Dir = $repo }
)

function Start-One($spec) {
  $log = Join-Path $logDir "$($spec.Name).log"
  # ログが大きくなりすぎないよう、起動のたびに、大きければ退避する
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 20MB)) { Move-Item $log "$log.old" -Force }
  $p = Start-Process -FilePath $spec.File -ArgumentList $spec.Args -WorkingDirectory $spec.Dir `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden -PassThru
  Write-Host ("{0:s} {1} を起動 (PID {2})" -f (Get-Date), $spec.Name, $p.Id)
  return $p
}

$running = @{}
foreach ($spec in $specs) { $running[$spec.Name] = Start-One $spec }

function Save-Pids {
  $ids = @($PID) + @($running.Values | ForEach-Object { $_.Id })
  Set-Content -Path (Join-Path $runDir "pids.txt") -Value $ids
}
Save-Pids

# 落ちたら、少し待って起動し直す。短時間に落ち続ける場合は、待つ時間を延ばす（ログを埋めないため）
$failures = @{}
try {
  while ($true) {
    Start-Sleep -Seconds 5
    foreach ($spec in $specs) {
      $p = $running[$spec.Name]
      if (-not $p.HasExited) { $failures[$spec.Name] = 0; continue }
      $count = [int]$failures[$spec.Name] + 1
      $failures[$spec.Name] = $count
      Write-Host ("{0:s} {1} が終了 (code {2})。{3} 回目" -f (Get-Date), $spec.Name, $p.ExitCode, $count)
      Start-Sleep -Seconds ([Math]::Min(60, 3 * $count))
      $running[$spec.Name] = Start-One $spec
      Save-Pids
    }
  }
}
finally {
  foreach ($p in $running.Values) { if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } }
  $mutex.ReleaseMutex()
}
