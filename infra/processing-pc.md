# 処理PC の構築手順（I01）

学祭当日に、全プロセスを動かす PC（処理PC）の作り方。**電源を入れれば、全サービスが自動で立ち上がる**状態にする。
予備機でも、この手順どおりに進めれば同じ状態を再現できる（spec.md 4章）。手作業で変えたことは、必ずここに書き足す。

起動するもの：

| 何が | どう動くか |
| --- | --- |
| cloudflared（トンネル） | Windows サービス（PC の起動時に開始。手順 7） |
| Caddy・api・print-worker | ログオン時に、タスクスケジューラが `start-all.ps1` を実行。落ちたら自動で再起動する（手順 8） |
| web・staff の画面 | ビルドした静的ファイルを Caddy が配信する（I02 で行う。I01 の範囲外） |

スクリプトは、すべて `infra/windows/` にある。**管理者の PowerShell** と書いてある手順は、スタートメニューで PowerShell を右クリックして「管理者として実行」を選ぶ。

> 開発用のPC では、`configure-processing-pc.ps1`（手順 5）を**実行しない**。スリープしなくなり、画面がロックされなくなる。

## 1. 専用ユーザーを作る

自動ログオンに使う、**標準ユーザー**（管理者ではない）を作る。以降の手順では、`canbadge` という名前で書く。

管理者の PowerShell:

```powershell
$password = Read-Host "canbadge のパスワード" -AsSecureString
New-LocalUser -Name "canbadge" -Password $password -PasswordNeverExpires -AccountNeverExpires
```

- パスワードは、人に見られても困らない範囲で、十分に長いものにする（自動ログオンで使う。手順 6）
- 管理者の作業（手順 5・7・8 の一部）は、管理者ユーザーで行う。それ以外は `canbadge` で行う

## 2. 場所とフォルダ

- リポジトリは `C:\canbadge` に置く（パスにスペースや日本語を入れない）
- DB・画像・生成 PDF・ログは、リポジトリ内の `data\` に作られる（I04 のバックアップ対象）

## 3. ツールを入れる

`canbadge` でログオンして、通常の PowerShell から:

```powershell
cd C:\canbadge\infra\windows   # リポジトリを取得したあと（手順 4）に実行する
.\install-tools.ps1
```

Git・Bun・Caddy・cloudflared・SumatraPDF が入る。終わったら PowerShell を開き直して確認する。

```powershell
git --version
bun --version
caddy version
cloudflared --version
```

プリンター（Canon PIXUS TS6730）のドライバーの導入と、既定のプリンターの設定は、P03・Q02 で行う。

## 4. リポジトリを取得する

```powershell
cd C:\
git clone https://github.com/sofken2/canbadge-order-system.git canbadge
cd canbadge
bun install
copy .env.example .env
```

`.env` を開いて、本番の値を書く（`.env` はコミットされない）。

| キー | 値 |
| --- | --- |
| `STAFF_HOST` | `badge-staff.sofken2-ts.app`（`start-all.ps1` が Caddy に渡す） |
| `CF_ACCESS_TEAM_DOMAIN`・`CF_ACCESS_AUD` | [cloudflare.md](cloudflare.md) の 2 章 |
| `TURNSTILE_SITE_KEY`・`TURNSTILE_SECRET_KEY` | [cloudflare.md](cloudflare.md) の 3 章 |

DB は、初回起動時に自動で作られる。**本番では `bun run db:reset` を実行しない**（データが消える）。

## 5. 電源・ロック画面・自動再起動の設定

**管理者の PowerShell**（本番の処理PC でだけ）:

```powershell
cd C:\canbadge\infra\windows
.\configure-processing-pc.ps1
```

スリープ・休止・画面オフを無効にし、ロック画面を出さず、ログオン中の自動再起動（Windows Update）をしないようにする。

## 6. 自動ログオン

パスワードを平文でレジストリに置かないよう、Microsoft の **Autologon**（Sysinternals）を使う。パスワードは暗号化して保存される。

1. https://learn.microsoft.com/sysinternals/downloads/autologon から Autologon をダウンロードして展開する
2. **管理者として** `Autologon64.exe` を実行する
3. Username に `canbadge`、Domain にコンピューター名（空でもよい）、Password に手順 1 のパスワードを入れて **Enable** を押す
4. 再起動して、自動で `canbadge` にログオンすることを確認する

自動ログオンは、PC に触れる人は、誰でもその画面を使える。**処理PC は、ブースの人目の届く場所に置く**。

**BIOS の設定**：停電や電源の抜けから復帰したときに、自動で電源が入るようにする（機種により「AC Power Recovery」「Restore on AC Power Loss」など。「Power On」にする）。

## 7. トンネルを Windows サービスにする

[cloudflare.md](cloudflare.md) の 1 章のとおり。前提として、`canbadge` ユーザーの `%USERPROFILE%\.cloudflared\` に、`config.yml` と認証ファイル（`<トンネルID>.json`）、`cert.pem` が必要。別の PC で作ったものは、安全な方法で渡す（USB など。メールやチャットに貼らない）。

**管理者の PowerShell**:

```powershell
cd C:\canbadge\infra\windows
.\install-cloudflared-service.ps1
```

## 8. 起動タスクを登録する

**管理者の PowerShell**:

```powershell
cd C:\canbadge\infra\windows
.\register-startup-task.ps1 -User canbadge
```

`canbadge` でログオンすると、`start-all.ps1` が実行される（Caddy・api・print-worker）。

## 8-2. バックアップの定期実行

DB と画像を、数分おきに、別のドライブへ複製する。手順は [backup.md](backup.md) の 1 章（`.env` の `BACKUP_DIR`、`register-backup-task.ps1`）。

## 8-3. プリンターの設定（P03）

印刷は、SumatraPDF が、`.env` の `PRINTER_NAME` のプリンターへ、**拡大縮小なし**で送る（`apps/print-worker/CLAUDE.md`）。実寸を保つため、次を、処理PC で、先にやっておく。

1. **プリンターを登録する。** 処理PC に、プリンター（Canon PIXUS TS6730）をつなぎ、Windows の「設定 → Bluetooth とデバイス → プリンターとスキャナー」に追加する。**Canon 公式のドライバーを入れる**のがよい（Windows 標準の「Microsoft IPP Class Driver」は、用紙の種類・品質・フチなしの設定が、限られることがある）
2. **名前を調べて、`.env` に書く。** リポジトリの `apps/print-worker` で `bun run printers`。出てきた名前を、そのまま `.env` の `PRINTER_NAME` に書く。あわせて `PRINT_DRIVER=sumatra`
3. **印刷の既定値を決める。** そのプリンターの「印刷設定（基本設定）」で、次にする（SumatraPDF は、ここに載っている既定値で印刷する）。
   - 用紙サイズ：**A4**。用紙の種類：使う用紙（普通紙・フォト用紙など。インクの量と色が変わる）
   - 印刷品質：標準以上。**カラー**。**両面印刷：オフ**。**フチなし印刷：オフ**（フチあり。縁の余白は、`badgeSpec.paper.unprintableMarginMm` で見込んである。実測は、下の 5）
   - 「用紙に合わせる」「縮小」のような、拡大縮小の設定が、プリンター側にあれば、すべてオフ
4. **SumatraPDF が入っているか。** `install-tools.ps1`（3 章）が入れる。`%LOCALAPPDATA%\SumatraPDF\SumatraPDF.exe` があること（別の場所なら `.env` の `SUMATRA_PATH`）
5. **較正する（実機で。P01・P03）。**
   1. `bun run calibration --print` で、較正用ページを、実際に印刷する（用紙が 1 枚出る）
   2. **入れ子の枠**：全体が見える、いちばん外側の枠が、プリンターの印刷できない縁の幅（mm）。`badgeSpec.paper.unprintableMarginMm` を、これ以上にする
   3. **定規**：横（160mm）と縦（260mm）を、定規で測る。`scaleX = 160 ÷ 横の実測`、`scaleY = 260 ÷ 縦の実測`
   4. **円**：70mm と 58mm の円の直径を測る。定規の倍率と、合っているかを見る
   5. 値を `packages/badge-spec/src/spec.ts` の `calibration` に入れ、`bun run calibration --applied --print` で、もう一度、印刷する。定規が、指定どおりの長さになっていること
   6. **ずれが残る**（倍率が合わない）ときは、プリンターの設定（拡大縮小・フチなし）を疑う。`noscale` は、SumatraPDF 側の指定で、プリンター側の拡大は止められない
6. **確認：** スタッフ画面で、実際の注文を 1 件、支払い済みにして、印刷されたシートを、S03 の画面と、見比べる（並び順・注文番号）。バッジマシンで、実際にプレスして、仕上がりを見る（Q01）

**印刷が失敗したときの動き：** ドライバーが失敗しても（プリンターの電源が切れている・用紙切れなど）、自動では、印刷し直さない。スタッフ画面の「印刷確認」に、そのシートが残る。用紙が出ていなければ、「再印刷」を選ぶと、次のシートで印刷される。

## 9. Windows Update

学祭の前後で、更新による再起動や遅さが出ないようにする。

1. **学祭の 1〜2 週間前**に、すべての更新を当てて、再起動する。そのあと、一通りの動作確認（手順 10）をする
2. **学祭の直前**に、設定アプリ → Windows Update → **更新の一時停止**（最大 5 週間）を選ぶ
3. 学祭が終わったら、一時停止を解除する

Windows の Pro 以上では、グループポリシーでより細かく制御できる。Home は、一時停止が確実な方法。

## 10. 再起動して確認する

PC を再起動して、**何も操作せずに**次が揃うことを確認する。

| # | 確認 | 結果 |
| --- | --- | --- |
| 1 | 自動で `canbadge` にログオンする（ロック画面もパスワードも出ない） | |
| 2 | `Get-Service Cloudflared` が `Running` | |
| 3 | 1〜2 分以内に、`http://localhost:8080/` が開く（Caddy） | |
| 4 | `http://localhost:3002/api/status` が JSON を返す（api） | |
| 5 | `data\logs\print-worker.log` が更新されている（print-worker） | |
| 6 | スマホ（モバイル回線）で `https://badge.sofken2-ts.app/` が開く | |
| 7 | 15 分放置しても、画面が消えず、スリープしない | |
| 8 | api のプロセスを終了すると、数秒で自動で戻る（`Stop-Process -Name bun` ではなく、PID を指定して試す） | |

## 運用

| やること | コマンド（PowerShell） |
| --- | --- |
| 手動で全部止める | `C:\canbadge\infra\windows\stop-all.ps1` |
| 手動で全部起動する | `C:\canbadge\infra\windows\start-all.ps1` |
| ログを見る | `C:\canbadge\data\logs\` の `caddy.log`・`api.log`・`print-worker.log`（`.err` は標準エラー） |
| コードを更新する | `cd C:\canbadge; git pull; bun install; bun run build` のあと、`stop-all.ps1` → `start-all.ps1`（画面は、ビルドしないと更新されない） |

- 落ちたプロセスは、`start-all.ps1` が数秒〜1 分後に自動で起動し直す。落ち続けるときは、待つ時間を延ばしながら、ログに記録する
- ログが 20 MB を超えると、次の起動時に `.old` に退避される

## 呼び出しモニターの自動表示（任意。S05・Q02 で確定する）

処理PC の 2 画面目に、ログオン時に全画面で出す場合は、スタートアップフォルダ（`shell:startup`）に、次を開くショートカットを置く。

```
chrome.exe --kiosk --new-window http://staff.localhost:8080/monitor
```

`staff.localhost` は、その PC の中からしか開けず、Access のログインは要らない（Caddyfile で、常にスタッフ用にしてある）。

## 残っている作業

- [ ] 本番の処理PC での、上の手順の実施と、手順 10 の確認（スクリプトは、開発機で起動・自動再起動・停止まで確認済み。電源設定・自動ログオン・タスク登録は、本番機で未実施）
- [ ] I02：web・staff を Caddy が配信し、`/api` を api に転送する
- [ ] P03：SumatraPDF の呼び出しと、プリンターの設定
- [ ] I04：バックアップ
