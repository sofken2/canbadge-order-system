# 起動と停止（処理PC）

サイトを動かす・止める手順。**管理者権限は、要らない**（初回の自動起動の登録だけ、管理者）。

- 場所：`C:\Users\2005t\Desktop\MYDevs\canbadge-order-system`（以下 `<repo>`）。PowerShell で `cd <repo>` してから行う
- 設定：`.env`（共通）と `.env.production`（処理PC。実プリンター・本番の URL・バックアップ先）。`start-all.ps1` が、両方を読む

## 動いているもの

| もの | 役割 | 起動するもの | ポート |
| --- | --- | --- | --- |
| Caddy | 画面の配信・`/api` の振り分け | `start-all.ps1` | 8080（来場者用・スタッフ用）・8081 |
| api | REST API・SSE | `start-all.ps1` | 3002 |
| print-worker | 印刷（実プリンターへ） | `start-all.ps1` | なし |
| cloudflared（トンネル） | 公開 URL をこの PC につなぐ | **別に起動する** | なし |

`start-all.ps1` は、Caddy・api・print-worker を起動し、**落ちたら、自動で起動し直す**（数秒〜1 分後）。トンネルは、これに**含まれない**。

## 1. 起動

### 1-1. 起動の前に（毎回）
1. **すでに動いていないか確認する**。二重に起動すると、ポートが衝突して、Caddy と api が、落ちては再起動を繰り返す（ログに `Only one usage of each socket address` が出る）

   ```powershell
   Get-Process caddy, bun -ErrorAction SilentlyContinue      # 何も出なければ、動いていない
   ```
   出たら、先に「2. 停止」を行う
2. 最新にする（コードが変わったときだけ。**画面は、ビルドしないと、反映されない**）

   ```powershell
   git pull; bun install; bun run build
   ```
3. プリンターに **A4 の普通紙**が入っている。PC が**スリープしない**
4. **前回の注文が、残っていないか**：支払い済みで印刷待ちの注文があると、起動と同時に、**実プリンターで印刷される**。前回、印刷中のまま終了したシートは、print-worker の起動時に、印刷済みとして扱われる（ログに出る）。データを空にして始めるなら、5 章

### 1-2. サーバー（Caddy・api・print-worker）

```powershell
.\infra\windows\start-all.ps1
```
窓は、開いたままにする（閉じると、止まる）。窓を出さずに、起動するなら、次のとおり。

```powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','.\infra\windows\start-all.ps1'
```

**`start-all.ps1` を、2 回起動しない。**

### 1-3. トンネル（公開 URL をつなぐ）

**A. 通常のプロセス**（PC を再起動すると、止まる。窓を閉じると、切れる）

```powershell
cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\config.yml" --no-autoupdate run
```
`Registered tunnel connection` が 4 つ出れば、つながっている。

**B. Windows サービス**（管理者の PowerShell。再起動しても、自動で上がる）

```powershell
Start-Service Cloudflared
```

**A と B は、同時に動かさない**（2 台がつながったと扱われ、診断が警告する）。

### 1-4. 起動したあと

| 確認 | コマンド・場所 | 期待する結果 |
| --- | --- | --- |
| 全体の診断 | `.\infra\windows\check-processing-pc.ps1 -Public` | NG がない（外付けドライブ・自動起動の NG は、後回しでよい） |
| api | `http://localhost:3002/api/health` | `{"status":"ok",...}` |
| 営業開始 | スタッフ用「設定」画面 →「営業開始」 | 日付が変わったら、**毎日**押す（注文番号が 001 から始まる）。受付は「受付中」 |

### URL

| 画面 | URL |
| --- | --- |
| 来場者用 | https://badge.sofken2-ts.app/ |
| スタッフ用 | https://badge-staff.sofken2-ts.app/（Access のログイン）。この PC の中は `http://staff.localhost:8080/`（ログイン不要） |
| 呼び出しモニター | `http://staff.localhost:8080/monitor`（この PC の中だけ） |

## 2. 停止

### 2-1. サーバー

```powershell
.\infra\windows\stop-all.ps1
```
`data\run\pids.txt` に記録された PID（start-all 自身・Caddy・api・print-worker）を、止める。

**注意：`start-all.ps1` を 2 回起動すると、記録が上書きされ、先に起動した一式を、`stop-all.ps1` が、止められなくなる。** その場合は、手で止める。

```powershell
Get-Process caddy, bun -ErrorAction SilentlyContinue | Stop-Process -Force
```
止めたあと、残っていないことを確認する。

```powershell
Get-Process caddy, bun -ErrorAction SilentlyContinue                                  # 何も出ない
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3002,8080,8081 } # 何も出ない
```

### 2-2. トンネル

| 起動のしかた | 止め方 |
| --- | --- |
| A（通常のプロセス） | その窓で `Ctrl+C`。窓がなければ `Get-Process cloudflared \| Stop-Process` |
| B（サービス） | 管理者の PowerShell で `Stop-Service Cloudflared` |

止めると、公開 URL は、つながらなくなる（`502`）。サーバーだけ止めて、トンネルを残すと、来場者には、エラーが見える。**止めるときは、トンネル → サーバー**、**起動するときは、サーバー → トンネル**の順にする。

## 3. 再起動したいとき（コードを更新した・設定を変えた）

```powershell
.\infra\windows\stop-all.ps1
git pull; bun install; bun run build        # 必要なときだけ
.\infra\windows\start-all.ps1
```
トンネルは、そのままでよい。**`.env` や `.env.production` を変えたら、`stop-all` → `start-all`**（実行中のプロセスは、起動時にしか、読まない）。画面の設定（`VITE_` の値）を変えたときは、`bun run build` も要る。

## 4. 自動起動（管理者・初回だけ）

PC を再起動しても、自動で上がるようにする。

```powershell
.\infra\windows\setup-processing-pc.ps1 -DryRun            # 何をするかだけを、先に見る
.\infra\windows\setup-processing-pc.ps1 -Tunnel -StartNow  # 登録して、いま起動する
```

| 指定 | すること |
| --- | --- |
| （なし） | ツール・ビルド・自動起動のタスク・バックアップ先 |
| `-Tunnel` | トンネルを、Windows サービスにして、起動する |
| `-ConfigurePower` | スリープ・画面ロック・自動再起動をしない設定（当日の直前。元に戻す：`restore-power-settings.ps1`） |
| `-StartNow` | サーバーを、いま起動する |

登録後は、1-2・1-3 の手動の起動は要らない。解除は、`Unregister-ScheduledTask -TaskName canbadge-start-all -Confirm:$false`（サーバー）／`cloudflared service uninstall`（トンネル）。

## 5. データを空にして始める（テストのあと・本番の前）

注文・画像・印刷の履歴を、まっさらにする。

### 5-1. 設定画面のボタン（ふつうは、こちら）

サーバーを動かしたまま、できる。

1. スタッフ用「設定・売上」→「受付」タブで、**「受付を終了する」**を押す（受付中・ビジーのあいだは、押せない）。印刷中のシートが済むのを待つ
2. いちばん下の「データのリセット」で、**「データをリセットする」**を押す。消える件数を見て、**「リセット」と打ち込んで**、「リセットする」を押す
3. **「営業を開始する」**を押す（注文番号が 1 から始まる）

- 消すもの：注文（売上を含む）・印刷の履歴と PDF・アーカイブの作品と通報・画像・操作ログ。**残すもの：価格・上限・在庫の総数などの設定**。残りの数は、注文を消すと、総数に戻る
- 消す前に、DB・画像・PDF を、`data\old-<日時>\` に退避する（元に戻すときは、5-2 の手で入れ替える）。要らなくなったら、手で消す

### 5-2. 手で行う（ボタンが使えないとき・退避から戻すとき）

**先に、サーバーを止める**（動いたままだと、ファイルが、消せない）。

```powershell
.\infra\windows\stop-all.ps1
$stamp = Get-Date -Format yyyyMMdd-HHmmss
New-Item -ItemType Directory data\old-$stamp | Out-Null
Move-Item data\app.db, data\app.db-shm, data\app.db-wal data\old-$stamp -ErrorAction SilentlyContinue
.\infra\windows\start-all.ps1                  # 空の DB が、自動で作られる
```
- 退避するだけで、消さない（`data\old-<日時>\`）。要らなくなったら、手で消す
- 空にしたあと、**設定画面で、価格・上限・印刷を待つ時間を、入れ直す**（既定値に戻る）。**営業開始**を、押す
- 画像（`data\images\`）と PDF（`data\sheets\`）は、残る。使われない画像は、自動で消える（15 分後）

## 6. 困ったとき

| 症状 | 原因と対処 |
| --- | --- |
| `start-all` が、「Caddy が終了」「api が終了」を、繰り返す | **すでに動いている**（二重起動）。「2. 停止」で、`caddy`・`bun` を止めて、**1 回だけ**起動し直す。`data\logs\api.log.err`・`caddy.log.err` を見る |
| 公開 URL が `502` | サーバーが止まっている。1-2 を行う |
| 公開 URL が開かない（接続できない） | トンネルが止まっている。1-3 を行う。診断で、「トンネルのつなぎ手」が 0 台と出る |
| 診断で、「トンネルのつなぎ手が 2 台以上」 | 別の PC・または、通常プロセスとサービスの両方が、つないでいる。片方を止める |
| 注文が、印刷されない | ① 印刷を「止める」状態か（印刷の最上段。**プリンターの失敗で、自動で止まる**ことがある。直して、再開する）② 待ち時間（設定）がまだ。印刷待ちは、印刷の最上段に出る ③ プリンターの用紙・状態・キュー（`Get-PrintJob -PrinterName "Canon TS6730 series"`） |
| 起動と同時に、勝手に印刷された | 前回の、支払い済みの注文が、残っていた。5 章で、空にして始める |
| 画面が、古いまま | `bun run build` をしていない。ビルドして、`stop-all` → `start-all` |

ログは、`<repo>\data\logs\` の `caddy.log`・`api.log`・`print-worker.log`（`.err` は標準エラー）。20 MB を超えると、次の起動時に `.old` に退避される。

## 関連

- 初回の構築・自動起動・電源の設定：[processing-pc.md](processing-pc.md)
- PC を替える・診断：[moving.md](moving.md)
- Cloudflare・トンネルの設定：[cloudflare.md](cloudflare.md)
- 実機の確認表：[rehearsal-checklist.md](rehearsal-checklist.md)
- バックアップ：[backup.md](backup.md)
