# cloudflared を Windows サービスにする（処理PC で、管理者の PowerShell から実行する）。
#
# サービスは SYSTEM アカウントで動くので、ユーザーの %USERPROFILE%\.cloudflared ではなく
# C:\Windows\System32\config\systemprofile\.cloudflared を見る。設定と認証ファイルをそこへ
# 複製し、credentials-file のパスも書き換えてから登録する。
# 認証ファイル（<トンネルID>.json）は秘密情報。複製先は SYSTEM と管理者だけが読める場所。
#
# このファイルは UTF-8（BOM 付き）で保存する。BOM がないと、Windows PowerShell 5.1 は
# 日本語を文字化けさせて構文エラーにする。
#
# 使い方:  .\install-cloudflared-service.ps1
# 解除:    cloudflared service uninstall

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

$source = Join-Path $env:USERPROFILE ".cloudflared"
$target = "C:\Windows\System32\config\systemprofile\.cloudflared"
$config = Join-Path $source "config.yml"

if (-not (Test-Path $config)) {
  throw "$config がありません。infra/README.md の 4-1 の手順 5 を先に済ませてください"
}
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  throw "cloudflared が見つかりません。winget install --id Cloudflare.cloudflared -e を実行してください"
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $source "*.json") $target -Force
Copy-Item (Join-Path $source "cert.pem") $target -Force -ErrorAction SilentlyContinue

# credentials-file を、複製先のパスに書き換えて置く。
# BOM なしで書く（PowerShell 5.1 の Set-Content -Encoding utf8 は BOM を付ける）
$text = Get-Content $config -Raw
$text = [regex]::Replace($text, "(?m)^credentials-file:.*$", {
  param($m)
  $name = [regex]::Match($m.Value, "[^/\\]+\.json").Value
  "credentials-file: " + ($target -replace "\\", "/") + "/" + $name
})
$targetConfig = Join-Path $target "config.yml"
[System.IO.File]::WriteAllText($targetConfig, $text, (New-Object System.Text.UTF8Encoding($false)))

# 外部コマンドは失敗しても例外にならないので、結果を確かめてから先へ進む
if ((Get-Item $targetConfig).Length -eq 0) { throw "$targetConfig が空です" }
Write-Host "複製した設定: $targetConfig"
Get-Content $targetConfig

# 以前のサービスが残っていたら、いったん外す（設定を入れ替えて登録し直せるように）。
# 空の設定で動いていた古いサービスは、停止の合図に応答しないことがあるので、
# 一定時間待っても止まらなければプロセスを終了させる
$old = Get-Service Cloudflared -ErrorAction SilentlyContinue
if ($old) {
  Stop-Service Cloudflared -NoWait -ErrorAction SilentlyContinue
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Service Cloudflared).Status -ne "Stopped" -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
  }
  if ((Get-Service Cloudflared).Status -ne "Stopped") {
    $procId = (Get-CimInstance Win32_Service -Filter "Name='Cloudflared'").ProcessId
    if ($procId -gt 0) { Stop-Process -Id $procId -Force }
  }
  cloudflared service uninstall
}

cloudflared --config $targetConfig tunnel ingress validate
if ($LASTEXITCODE -ne 0) { throw "設定の検証に失敗しました" }
cloudflared --config $targetConfig service install
if ($LASTEXITCODE -ne 0) { throw "サービスの登録に失敗しました" }
Stop-Service Cloudflared -ErrorAction SilentlyContinue

# 登録直後のサービスは、引数なしで cloudflared.exe を起動し、すぐ落ちる（終了コード 1067）。
# 設定とトンネルの実行を、起動の引数で明示する。ログも残す（落ちた理由を後から読めるように）。
# sc.exe config binPath= は、PowerShell 5.1 だと引用符が崩れるので、レジストリで直接書く
$exe = (Get-CimInstance Win32_Service -Filter "Name='Cloudflared'").PathName.Trim('"')
$logDir = Join-Path $env:ProgramData "cloudflared"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "cloudflared.log"
$command = "`"$exe`" --config `"$targetConfig`" --logfile `"$logFile`" tunnel run"
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared" -Name ImagePath -Value $command

# 落ちたら自動で再起動し、PC の起動時に始まるようにする
sc.exe config Cloudflared start= auto | Out-Null
sc.exe failure Cloudflared reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
Start-Service Cloudflared
Start-Sleep -Seconds 8

$state = (Get-Service Cloudflared).Status
Get-Service Cloudflared
if ($state -ne "Running") { throw "サービスが起動していません。ログを確認してください: $logFile" }
Write-Host "ログ: $logFile"
Get-Content $logFile -Tail 5
