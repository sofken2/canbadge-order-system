# 処理PC の全プロセス（Caddy・api・print-worker）を起動し、落ちたら再起動し続ける。
# ログオン時にタスクスケジューラから呼ばれる（register-startup-task.ps1 が登録する）。
# 手動で試すときは、PowerShell から実行して、止めるときは stop-all.ps1。
#
# cloudflared は、別の Windows サービス（install-cloudflared-service.ps1）なので、ここでは扱わない。
# web・staff の画面は、ビルドした静的ファイルを Caddy が配信する（I02）。
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")
$repo = Get-RepoRoot
Set-Location $repo

# 二重起動を防ぐ（ログオンのたびに、前のものが残っていても増えないように）
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\canbadge-start-all", [ref]$createdNew)
if (-not $createdNew) { Write-Host "すでに start-all が動いています"; exit 0 }

$logDir = Join-Path $repo "data\logs"
$runDir = Join-Path $repo "data\run"
New-Item -ItemType Directory -Force -Path $logDir, $runDir | Out-Null

# Caddy は .env を読まないので、必要な値だけをここで取り出す（.env.production が優先。common.ps1）
$staffHost = Read-EnvValue "STAFF_HOST"
if ($staffHost) { $env:STAFF_HOST = $staffHost }
$caddyPort = Read-EnvValue "CADDY_PORT"
if ($caddyPort) { $env:CADDY_PORT = $caddyPort }

# Anubis（ボット対策。infra/anubis/）。ANUBIS_ENABLED=1 のときだけ、Caddy が HTML の要求を Anubis に渡し、ここで起動する
$anubisEnabled = (Read-EnvValue "ANUBIS_ENABLED") -eq "1"
if ($anubisEnabled) { $env:ANUBIS_ENABLED = "1" }

function Resolve-Tool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { throw "$name が見つかりません。infra/processing-pc.md の手順 3 を確認してください" }
  return $cmd.Source
}

# 開発時の `bun run dev` と同じく .env.example を土台に .env で上書きし、さらに .env.production（処理PC の設定）で上書きする
$bunEnv = Get-BunEnvArgs $repo

$bun = Resolve-Tool "bun"
$caddy = Resolve-Tool "caddy"

$specs = @(
  @{ Name = "caddy"; File = $caddy; Args = @("run", "--config", "Caddyfile", "--adapter", "caddyfile"); Dir = (Join-Path $repo "infra\caddy") },
  @{ Name = "api"; File = $bun; Args = $bunEnv + @("apps/api/src/index.ts"); Dir = $repo },
  @{ Name = "print-worker"; File = $bun; Args = $bunEnv + @("apps/print-worker/src/index.ts"); Dir = $repo }
)

if ($anubisEnabled) {
  $anubisExe = Join-Path $repo "data\tools\anubis\anubis.exe"
  if (-not (Test-Path $anubisExe)) { throw "Anubis が見つかりません。infra\windows\install-anubis.ps1 を実行してください" }
  $anubisPort = Read-EnvValue "ANUBIS_PORT"; if (-not $anubisPort) { $anubisPort = "8923" }
  $originPort = Read-EnvValue "WEB_ORIGIN_PORT"; if (-not $originPort) { $originPort = "8081" }
  $env:ANUBIS_PORT = $anubisPort
  $env:WEB_ORIGIN_PORT = $originPort
  $difficulty = Read-EnvValue "ANUBIS_DIFFICULTY"; if (-not $difficulty) { $difficulty = "4" }
  # 署名鍵が決まっていないと、再起動のたびに、来場者が確認をやり直す（ANUBIS_ED25519_PRIVATE_KEY_HEX に 64 桁の 16 進数）
  $anubisKey = Read-EnvValue "ANUBIS_ED25519_PRIVATE_KEY_HEX"
  if (-not $anubisKey) { Write-Host "注意: ANUBIS_ED25519_PRIVATE_KEY_HEX が未設定です（再起動のたびに、来場者の確認がやり直しになります）" }
  # Anubis は、設定を環境変数で受け取る（Env は、その起動のときだけ設定する）。
  # この PC の中（Caddy）からしか届かないよう、127.0.0.1 で待ち受ける
  $anubisEnv = @{
    BIND = "127.0.0.1:$anubisPort"
    TARGET = "http://127.0.0.1:$originPort"
    POLICY_FNAME = (Join-Path $repo "infra\anubis\botPolicies.yaml")
    DIFFICULTY = $difficulty
    METRICS_BIND = "127.0.0.1:9090"
  }
  if ($anubisKey) { $anubisEnv["ED25519_PRIVATE_KEY_HEX"] = $anubisKey }
  $specs += @{ Name = "anubis"; File = $anubisExe; Args = @(); Dir = $repo; Env = $anubisEnv }
}

function Start-One($spec) {
  $log = Join-Path $logDir "$($spec.Name).log"
  # ログが大きくなりすぎないよう、起動のたびに、大きければ退避する
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 20MB)) { Move-Item $log "$log.old" -Force }
  # Env は、この 1 つのプロセスだけに渡す（ほかのプロセスに、BIND・TARGET などが混ざらないように）
  if ($spec.Env) { foreach ($key in $spec.Env.Keys) { Set-Item -Path "Env:$key" -Value $spec.Env[$key] } }
  try {
    $startArgs = @{
      FilePath = $spec.File; WorkingDirectory = $spec.Dir; WindowStyle = "Hidden"; PassThru = $true
      RedirectStandardOutput = $log; RedirectStandardError = "$log.err"
    }
    # 引数のない起動（Anubis）に、空の ArgumentList を渡すと、PowerShell 5.1 がエラーにする
    if ($spec.Args.Count -gt 0) { $startArgs["ArgumentList"] = $spec.Args }
    $p = Start-Process @startArgs
  } finally {
    if ($spec.Env) { foreach ($key in $spec.Env.Keys) { Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue } }
  }
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
