# この PC が、処理PC として動かせる状態かを、まとめて確かめる（何も変更しない。管理者でなくてよい）。
# PC を替えたとき・当日の前・不具合のときに、まず、これを実行する。足りないものと、直し方が、一覧で出る。
#
# 使い方:  .\check-processing-pc.ps1
#          .\check-processing-pc.ps1 -Public     （公開の URL へ、実際に、つないで確かめる。回線が要る）
#
# 結果:  OK＝問題なし／注意＝今すぐでなくてよいが、本番までに見直す／NG＝直さないと動かない
#        NG が 1 つでもあれば、終了コード 1
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

param([switch]$Public)

. (Join-Path $PSScriptRoot "common.ps1")
$repo = Get-RepoRoot
$script:ng = 0
$script:warn = 0

function Report([string]$level, [string]$name, [string]$detail = "", [string]$fix = "") {
  $color = "Green"
  if ($level -eq "NG") { $script:ng++; $color = "Red" }
  if ($level -eq "注意") { $script:warn++; $color = "Yellow" }
  $line = "[{0,-2}] {1}" -f $level, $name
  if ($detail) { $line += "  - $detail" }
  Write-Host $line -ForegroundColor $color
  if ($fix -and $level -ne "OK") { Write-Host "       直し方: $fix" -ForegroundColor DarkGray }
}
function Section([string]$title) { Write-Host ""; Write-Host "■ $title" -ForegroundColor Cyan }

function Get-Http([string]$url, [int]$timeoutSec = 8) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $timeoutSec -MaximumRedirection 0 -ErrorAction Stop
    return @{ Status = [int]$r.StatusCode; Body = $r.Content; Headers = $r.Headers }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) { return @{ Status = [int]$resp.StatusCode; Body = ""; Headers = $resp.Headers; Location = $resp.Headers["Location"] } }
    return $null
  }
}

Write-Host "処理PC の確認: $env:COMPUTERNAME  ($repo)"

# --- ツール ----------------------------------------------------------------
Section "ツール"
foreach ($tool in @(@("git", "Git.Git"), @("bun", "Oven-sh.Bun"), @("caddy", "CaddyServer.Caddy"), @("cloudflared", "Cloudflare.cloudflared"))) {
  $cmd = Get-Command $tool[0] -ErrorAction SilentlyContinue
  if ($cmd) { Report "OK" $tool[0] $cmd.Source } else { Report "NG" $tool[0] "見つからない" ".\infra\windows\install-tools.ps1（そのあと PowerShell を開き直す）" }
}
$sumatra = Read-EnvValue "SUMATRA_PATH" $repo
if (-not $sumatra) { $c = Get-Command "SumatraPDF" -ErrorAction SilentlyContinue; if ($c) { $sumatra = $c.Source } }
if (-not $sumatra) { $d = Join-Path $env:LOCALAPPDATA "SumatraPDF\SumatraPDF.exe"; if (Test-Path $d) { $sumatra = $d } }
if ($sumatra -and (Test-Path $sumatra)) { Report "OK" "SumatraPDF" $sumatra } else { Report "NG" "SumatraPDF" "見つからない（印刷に使う）" "winget install SumatraPDF.SumatraPDF（場所が違うなら、.env.production に SUMATRA_PATH）" }

# --- ビルド ----------------------------------------------------------------
Section "ビルド"
if (Test-Path (Join-Path $repo "node_modules")) { Report "OK" "bun install" "済み" } else { Report "NG" "bun install" "node_modules がない" "bun install" }
$builtAt = $null
foreach ($app in @("web", "staff")) {
  $index = Join-Path $repo "apps\$app\dist\index.html"
  if (Test-Path $index) {
    $t = (Get-Item $index).LastWriteTime
    if ($null -eq $builtAt -or $t -lt $builtAt) { $builtAt = $t }
    Report "OK" "$app の画面" "ビルド済み（$($t.ToString('MM/dd HH:mm'))）"
  } else { Report "NG" "$app の画面" "dist がない（Caddy が配信するもの）" "bun run build" }
}
if ($builtAt) {
  foreach ($f in @(".env", ".env.production")) {
    $p = Join-Path $repo $f
    if ((Test-Path $p) -and (Get-Item $p).LastWriteTime -gt $builtAt) {
      Report "注意" "画面が、$f より古い" "VITE_ の値（URL・Discord のボタン）が、反映されていないかもしれない" "bun run build"
    }
  }
}

# --- 設定 ------------------------------------------------------------------
Section "設定（.env と .env.production）"
if (Test-Path (Join-Path $repo ".env")) { Report "OK" ".env" "あり" } else { Report "NG" ".env" "ない" ".env.example をコピーして、値を入れる（infra/moving.md）" }
if (Test-Path (Join-Path $repo ".env.production")) { Report "OK" ".env.production" "あり" } else { Report "NG" ".env.production" "ない（処理PC の設定）" "infra\env.production.example をコピーして、リポジトリ直下に置く" }

foreach ($key in @("CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY")) {
  if (Read-EnvValue $key $repo) { Report "OK" $key "設定あり" } else { Report "NG" $key "未設定" ".env に入れる（infra/cloudflare.md）" }
}
$turnstileSecret = Read-EnvValue "TURNSTILE_SECRET_KEY" $repo
if ($turnstileSecret -and $turnstileSecret -match "^[123]x0{20,}") { Report "注意" "TURNSTILE_SECRET_KEY" "Cloudflare のテスト用の値のまま" "本番の値に替える" }
if ((Read-EnvValue "ALLOW_UNAUTHENTICATED_STAFF" $repo) -eq "1") { Report "NG" "ALLOW_UNAUTHENTICATED_STAFF=1" "スタッフ用が、認証なしで、公開される" ".env から消す" }

$driver = Read-EnvValue "PRINT_DRIVER" $repo
if ($driver -eq "sumatra") { Report "OK" "PRINT_DRIVER" "sumatra" } else { Report "NG" "PRINT_DRIVER" "'$driver'（本番は sumatra）" ".env.production に PRINT_DRIVER=sumatra" }
$siteUrl = Read-EnvValue "VITE_SITE_URL" $repo
if ($siteUrl -and $siteUrl -like "https://*") { Report "OK" "VITE_SITE_URL" $siteUrl } else { Report "NG" "VITE_SITE_URL" "'$siteUrl'（呼び出しモニターの QR になる。本番は https://）" ".env.production に書いて、bun run build" }
$staffHost = Read-EnvValue "STAFF_HOST" $repo
if ($staffHost) { Report "OK" "STAFF_HOST" $staffHost } else { Report "NG" "STAFF_HOST" "未設定（スタッフ用が、本番のホスト名で開かない）" ".env.production に STAFF_HOST" }
if ((Read-EnvValue "VITE_DISCORD_ENABLED" $repo) -eq "1") {
  $redirect = Read-EnvValue "DISCORD_REDIRECT_URI" $repo
  $siteHost = $null; if ($siteUrl) { try { $siteHost = ([Uri]$siteUrl).Host } catch {} }
  if (-not (Read-EnvValue "DISCORD_CLIENT_ID" $repo) -or -not (Read-EnvValue "DISCORD_CLIENT_SECRET" $repo) -or -not $redirect) {
    Report "NG" "Discord" "ボタンは出るが、DISCORD_* がそろっていない" "infra/discord.md"
  } elseif ($siteHost -and $redirect -notlike "https://$siteHost/*") {
    Report "注意" "Discord の戻り先" "$redirect（本番のドメインと違う。開発用のままかも）" ".env.production に DISCORD_REDIRECT_URI"
  } else { Report "OK" "Discord" "戻り先 $redirect" }
}

# --- プリンター ------------------------------------------------------------
Section "プリンター"
$printerName = Read-EnvValue "PRINTER_NAME" $repo
if (-not $printerName) {
  Report "NG" "PRINTER_NAME" "未設定" ".env.production に PRINTER_NAME（bun run printers で名前を確かめる）"
} else {
  $printer = Get-Printer -Name $printerName -ErrorAction SilentlyContinue
  if (-not $printer) {
    Report "NG" "プリンター '$printerName'" "この PC にない" "プリンターを追加するか、.env.production の PRINTER_NAME を直す（bun run printers）"
  } else {
    if ($printer.PrinterStatus -eq "Normal") { Report "OK" "プリンター '$printerName'" "正常" } else { Report "注意" "プリンター '$printerName'" "状態: $($printer.PrinterStatus)" "電源・用紙・インク・接続を見る" }
    $jobs = @(Get-PrintJob -PrinterName $printerName -ErrorAction SilentlyContinue)
    if ($jobs.Count -gt 0) { Report "注意" "印刷のジョブ" "$($jobs.Count) 件が残っている" "止まったジョブは、プリンターのキューから消す（二重に印刷されないよう、中身を見てから）" }
  }
}

# --- バックアップ ----------------------------------------------------------
Section "バックアップ"
$backupDir = Read-EnvValue "BACKUP_DIR" $repo
if (-not $backupDir) {
  Report "NG" "BACKUP_DIR" "未設定" ".env.production に BACKUP_DIR（別の物理ドライブ）"
} else {
  if (-not [System.IO.Path]::IsPathRooted($backupDir)) { $backupDir = Join-Path $repo $backupDir }
  if (-not (Test-Path $backupDir)) {
    Report "NG" "バックアップ先" "$backupDir が見つからない（外付けドライブが、つながっていない？）" "ドライブをつなぐか、BACKUP_DIR を直す"
  } else {
    Report "OK" "バックアップ先" $backupDir
    try {
      $probe = Join-Path $backupDir ".write-test-$PID"
      Set-Content -Path $probe -Value "x" -ErrorAction Stop; Remove-Item $probe -Force
    } catch { Report "NG" "バックアップ先に書けない" $backupDir "書き込みの権限・容量・読み取り専用を見る" }
    try {
      $repoDisk = (Get-Partition -DriveLetter $repo.Substring(0, 1) -ErrorAction Stop).DiskNumber
      $backupDisk = (Get-Partition -DriveLetter $backupDir.Substring(0, 1) -ErrorAction Stop).DiskNumber
      if ($repoDisk -eq $backupDisk) { Report "注意" "バックアップ先が、同じディスク" "PC のディスクが壊れたとき、データごと失う" "外付け SSD・USB メモリを用意して、BACKUP_DIR をそのドライブにする" }
      else { Report "OK" "バックアップ先は、別のディスク" "Disk $backupDisk（データは Disk $repoDisk）" }
    } catch { Report "注意" "バックアップ先のディスク" "同じディスクかを、判定できなかった" "手で確かめる" }
    $latest = Join-Path $backupDir "latest.json"
    if (Test-Path $latest) {
      $age = [int]((Get-Date) - (Get-Item $latest).LastWriteTime).TotalMinutes
      if ($age -le 15) { Report "OK" "最新のバックアップ" "$age 分前" } else { Report "注意" "最新のバックアップ" "$age 分前（15 分より古い）" ".\infra\windows\check-backup.ps1 / タスクが動いているか" }
    } else { Report "注意" "バックアップ" "まだ 1 回も取れていない" ".\infra\windows\run-backup.ps1 で 1 回取る" }
  }
}

# --- トンネル（Cloudflare）-------------------------------------------------
Section "トンネル（Cloudflare）"
$svc = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
if (-not $svc) {
  Report "NG" "Cloudflared サービス" "登録されていない" "管理者の PowerShell で .\infra\windows\install-cloudflared-service.ps1"
} else {
  if ($svc.Status -eq "Running") { Report "OK" "Cloudflared サービス" "動いている" } else { Report "NG" "Cloudflared サービス" "$($svc.Status)" "管理者の PowerShell で Start-Service Cloudflared" }
  if ($svc.StartType -ne "Automatic") { Report "注意" "Cloudflared の起動" "$($svc.StartType)（再起動したら、自動で立ち上がらない）" "管理者の PowerShell で Set-Service Cloudflared -StartupType Automatic" }
}
$tunnelConfig = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
if (Test-Path $tunnelConfig) {
  $tunnelId = $null
  foreach ($line in Get-Content $tunnelConfig -Encoding UTF8) { if ($line -match "^\s*tunnel:\s*(\S+)") { $tunnelId = $Matches[1]; break } }
  $cf = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($tunnelId -and $cf) {
    $info = (& $cf.Source tunnel info $tunnelId 2>&1 | Out-String)
    $connectors = @([regex]::Matches($info, "(?m)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s")).Count
    if ($connectors -eq 1) { Report "OK" "トンネルのつなぎ手" "1 台（この PC のはず）" }
    elseif ($connectors -eq 0) { Report "注意" "トンネルのつなぎ手" "0 台（どの PC も、つながっていない。来場者は、サイトを開けない）" "Cloudflared サービスを起動する" }
    else { Report "NG" "トンネルのつなぎ手" "$connectors 台がつながっている。別の PC も、同じトンネルにつないでいる" "古い PC で Stop-Service Cloudflared; Set-Service Cloudflared -StartupType Disabled（注文が、2 台の DB に、分かれてしまう）" }
  }
} else { Report "注意" "トンネルの設定" "$tunnelConfig がない" "infra/cloudflare.md、または infra/moving.md" }

# --- 自動起動 --------------------------------------------------------------
Section "自動起動（タスクスケジューラ）"
foreach ($task in @(@("canbadge-start-all", "Caddy・api・print-worker を、ログオン時に起動"), @("canbadge-backup", "バックアップを、数分おきに取る"))) {
  if (Get-ScheduledTask -TaskName $task[0] -ErrorAction SilentlyContinue) { Report "OK" $task[0] $task[1] } else { Report "NG" $task[0] "登録されていない（$($task[1])）" "管理者の PowerShell で .\infra\windows\setup-processing-pc.ps1" }
}

# --- 動いているか ----------------------------------------------------------
Section "いま動いているか"
$apiPort = Read-EnvValue "API_PORT" $repo; if (-not $apiPort) { $apiPort = "3002" }
$caddyPort = Read-EnvValue "CADDY_PORT" $repo; if (-not $caddyPort) { $caddyPort = "8080" }
$api = Get-Http "http://localhost:$apiPort/api/health" 4
if ($api -and $api.Status -eq 200) { Report "OK" "api" "http://localhost:$apiPort/api/health が 200" } else { Report "注意" "api" "応答がない（起動していない？）" ".\infra\windows\start-all.ps1" }
$caddy = Get-Http "http://localhost:$caddyPort/" 4
if ($caddy -and $caddy.Status -eq 200) { Report "OK" "Caddy（来場者用）" "http://localhost:$caddyPort/ が 200" } else { Report "注意" "Caddy" "応答がない（起動していない？）" ".\infra\windows\start-all.ps1" }
$workerLog = Join-Path $repo "data\logs\print-worker.log"
if (Test-Path $workerLog) {
  $age = [int]((Get-Date) - (Get-Item $workerLog).LastWriteTime).TotalMinutes
  if ($age -le 10) { Report "OK" "print-worker" "ログが $age 分前に更新" } else { Report "注意" "print-worker" "ログが $age 分、更新されていない（動いていない？ 静かなだけかも）" "data\logs\print-worker.log を見る" }
} else { Report "注意" "print-worker" "ログがない（まだ起動していない）" ".\infra\windows\start-all.ps1" }

# --- PC の状態 -------------------------------------------------------------
Section "PC の状態"
$drive = Get-PSDrive -Name $repo.Substring(0, 1) -ErrorAction SilentlyContinue
if ($drive) {
  $freeGb = [int]($drive.Free / 1GB)
  if ($freeGb -ge 10) { Report "OK" "空き容量" "$freeGb GB" } elseif ($freeGb -ge 2) { Report "注意" "空き容量" "$freeGb GB（画像と PDF が増える。余裕を持たせる）" "不要なファイルを消す" } else { Report "NG" "空き容量" "$freeGb GB" "空きを作る" }
}
$clock = Get-Http "https://www.cloudflare.com/cdn-cgi/trace" 6
if ($clock -and $clock.Headers -and $clock.Headers["Date"]) {
  try {
    $remote = [DateTime]::Parse($clock.Headers["Date"]).ToUniversalTime()
    $skew = [Math]::Abs(([DateTime]::UtcNow - $remote).TotalSeconds)
    if ($skew -le 60) { Report "OK" "時計" "ずれ $([int]$skew) 秒" } else { Report "NG" "時計" "$([int]$skew) 秒ずれている（Access のログインの署名が、期限切れ・未来と判定される）" "設定 → 時刻と言語 → 今すぐ同期（w32tm /resync）" }
  } catch { Report "注意" "時計" "判定できなかった" "" }
} else { Report "注意" "時計" "確かめられなかった（回線がない？）" "" }
$sleepSeconds = Get-AcSeconds "SUB_SLEEP" "STANDBYIDLE"
if ($null -eq $sleepSeconds) { Report "注意" "スリープ" "設定を読めなかった" "" }
elseif ($sleepSeconds -eq 0) { Report "OK" "スリープ" "しない設定（AC 接続時）" }
else { Report "注意" "スリープ" "$([int]($sleepSeconds / 60)) 分でスリープする設定（開発用のまま）" "当日の直前に、管理者の PowerShell で .\infra\windows\configure-processing-pc.ps1（元に戻す：restore-power-settings.ps1）" }

# --- 公開の URL（-Public のとき）-------------------------------------------
if ($Public) {
  Section "公開の URL（インターネット経由）"
  if ($siteUrl) {
    $pub = Get-Http "$($siteUrl.TrimEnd('/'))/api/health" 10
    if ($pub -and $pub.Status -eq 200) { Report "OK" "来場者用（$siteUrl）" "/api/health が 200" } else { Report "NG" "来場者用（$siteUrl）" "$(if ($pub) { $pub.Status } else { '届かない' })" "トンネル・Caddy・api を見る" }
  }
  if ($staffHost) {
    $staff = Get-Http "https://$staffHost/" 10
    $loc = ""; if ($staff -and $staff.Location) { $loc = [string]$staff.Location }
    if ($staff -and $staff.Status -in 301, 302, 303, 307 -and $loc -like "*cloudflareaccess.com*") { Report "OK" "スタッフ用（$staffHost）" "Access のログインへ向かう（認証なしでは、開かない）" }
    elseif ($staff -and $staff.Status -eq 200) { Report "NG" "スタッフ用（$staffHost）" "ログインなしで、開けてしまう" "Cloudflare の Access のアプリが、このホスト名に掛かっているか（infra/cloudflare.md）" }
    else { Report "注意" "スタッフ用（$staffHost）" "$(if ($staff) { $staff.Status } else { '届かない' })" "infra/cloudflare.md" }
  }
}

Write-Host ""
if ($script:ng -gt 0) { Write-Host "結果：NG $($script:ng) 件・注意 $($script:warn) 件。NG を直してから、もう一度実行してください。" -ForegroundColor Red; exit 1 }
if ($script:warn -gt 0) { Write-Host "結果：NG なし・注意 $($script:warn) 件。" -ForegroundColor Yellow; exit 0 }
Write-Host "結果：すべて OK" -ForegroundColor Green
exit 0
