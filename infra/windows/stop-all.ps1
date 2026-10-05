# start-all.ps1 が起動したプロセスを、すべて止める。
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pidFile = Join-Path $repo "data\run\pids.txt"
if (-not (Test-Path $pidFile)) { Write-Host "起動中のプロセスの記録がありません"; exit 0 }

# 先頭は start-all 自身。先に止めて、落ちたプロセスを起動し直さないようにする
$ids = Get-Content $pidFile | ForEach-Object { [int]$_ }
foreach ($id in $ids) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Write-Host "停止: $($p.ProcessName) (PID $id)" }
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
