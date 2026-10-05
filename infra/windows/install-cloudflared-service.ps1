# cloudflared を Windows サービスにする（処理PC で、管理者の PowerShell から実行する）。
#
# サービスは SYSTEM アカウントで動くので、ユーザーの %USERPROFILE%\.cloudflared ではなく
# C:\Windows\System32\config\systemprofile\.cloudflared を見る。設定と認証ファイルをそこへ
# 複製し、credentials-file のパスも書き換えてから登録する。
# 認証ファイル（<トンネルID>.json）は秘密情報。複製先は SYSTEM と管理者だけが読める場所。
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

# credentials-file を、複製先のパスに書き換えて置く
$text = Get-Content $config -Raw
$text = [regex]::Replace($text, "(?m)^credentials-file:.*$", {
  param($m)
  $name = [regex]::Match($m.Value, "[^/\]+\.json").Value
  "credentials-file: " + ($target -replace "\\", "/") + "/" + $name
})
Set-Content -Path (Join-Path $target "config.yml") -Value $text -Encoding utf8

cloudflared --config (Join-Path $target "config.yml") tunnel ingress validate
cloudflared --config (Join-Path $target "config.yml") service install

# 落ちたら自動で再起動し、PC の起動時に始まるようにする
sc.exe config Cloudflared start= auto | Out-Null
sc.exe failure Cloudflared reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
Start-Service Cloudflared
Get-Service Cloudflared
