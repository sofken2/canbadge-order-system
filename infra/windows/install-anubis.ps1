# Anubis（ボット対策の、リバースプロキシ。https://anubis.techaro.lol/）を、処理PC に入れる。
# 公式のリリース（GitHub）の Windows 用 zip を取り、ハッシュを確かめて、data\tools\anubis\anubis.exe に置く。
# data\ はコミット対象外なので、実行ファイルはリポジトリに入らない。
# 版を上げるときは、$version と $sha256 を、リリースのページの値に変える。
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

$ErrorActionPreference = "Stop"

$version = "1.27.0"
# GitHub の公式リリース（TecharoHQ/anubis v1.27.0）が示す、zip の SHA-256
$sha256 = "f752a55995f3bf4c12d2402f597404a4cbcce83900ae68f9406059a833df4664"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$dest = Join-Path $repo "data\tools\anubis"
$exe = Join-Path $dest "anubis.exe"

if ((Test-Path $exe) -and ((& $exe --version) -match [regex]::Escape($version))) {
  Write-Host "済み: Anubis v$version ($exe)"
  exit 0
}

$name = "anubis-$version-windows-amd64.zip"
$url = "https://github.com/TecharoHQ/anubis/releases/download/v$version/$name"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "canbadge-anubis"
New-Item -ItemType Directory -Force -Path $tmp, $dest | Out-Null
$zip = Join-Path $tmp $name

Write-Host "ダウンロード: $url"
Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

$actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
if ($actual -ne $sha256) {
  Remove-Item $zip -Force
  throw "ハッシュが一致しません（期待: $sha256 / 実際: $actual）。入れずに止めました"
}

Expand-Archive -Path $zip -DestinationPath $tmp -Force
Copy-Item (Join-Path $tmp "anubis-$version-windows-amd64\bin\anubis.exe") $exe -Force
Remove-Item $tmp -Recurse -Force
Write-Host "インストール済み: $exe"
& $exe --version
