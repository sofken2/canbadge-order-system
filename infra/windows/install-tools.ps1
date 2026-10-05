# 処理PC に必要なツールを winget で入れる（専用ユーザーで、通常の PowerShell から）。
# すでに入っているものは飛ばす。入れたあとは、PowerShell を開き直す（PATH を反映するため）。
#
# このファイルは UTF-8（BOM 付き）で保存する（Windows PowerShell 5.1 の文字化け対策）。

$ErrorActionPreference = "Stop"

$tools = @(
  @{ Command = "git"; Id = "Git.Git" },
  @{ Command = "bun"; Id = "Oven-sh.Bun" },
  @{ Command = "caddy"; Id = "CaddyServer.Caddy" },
  @{ Command = "cloudflared"; Id = "Cloudflare.cloudflared" }
)
foreach ($tool in $tools) {
  if (Get-Command $tool.Command -ErrorAction SilentlyContinue) {
    Write-Host "済み: $($tool.Command)"
  } else {
    Write-Host "インストール: $($tool.Id)"
    winget install --id $tool.Id -e --accept-package-agreements --accept-source-agreements
  }
}

# SumatraPDF は、PATH ではなくインストール先で探す（P03 が実際の場所を使う）
$sumatra = @("$env:LOCALAPPDATA\SumatraPDF\SumatraPDF.exe", "$env:ProgramFiles\SumatraPDF\SumatraPDF.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if ($sumatra) {
  Write-Host "済み: SumatraPDF ($sumatra)"
} else {
  Write-Host "インストール: SumatraPDF.SumatraPDF"
  winget install --id SumatraPDF.SumatraPDF -e --accept-package-agreements --accept-source-agreements
}

Write-Host ""
Write-Host "PowerShell を開き直して、次を確認してください: git --version / bun --version / caddy version / cloudflared --version"
