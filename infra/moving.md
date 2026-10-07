# 処理PC を替える（引っ越し）

いまの PC を処理PC にして開発を進めている。**別の Windows PC（予備機・本番用の PC）へ、いつでも、短い時間で、替えられる**ようにしてある。目安は、**新しい PC の準備ができていれば、30 分**（トンネルの切り替えは、数分）。

## 考え方

PC ごとに違うものは、少ない。そこに絞ってある。

| 何が | どこにあるか | PC を替えると |
| --- | --- | --- |
| コード | Git | `git clone` する |
| 設定（秘密を含む） | `.env`・`.env.production`（コミットしない） | **持っていく**（export → import） |
| トンネルの認証 | `%USERPROFILE%\.cloudflared\` | **持っていく**（同上。パスは自動で書き換わる） |
| データ（注文・画像） | `data\`（`app.db`・`images\`） | **バックアップから、復旧する**（同上） |
| **この PC に合わせる値** | `.env.production` の `PRINTER_NAME`・`BACKUP_DIR`（・`SUMATRA_PATH`） | **直す**（import が、直す箇所を教える） |
| 入れるもの（ツール・自動起動・サービス） | Windows | `setup-processing-pc.ps1` が入れる |

設定は、2 つに分けてある。

- `.env`：開発と共通（ポート・Cloudflare Access・Turnstile・Discord のキー）
- `.env.production`：**処理PC の起動（start-all）とビルドのときだけ**、`.env` を上書きする（実プリンターで印刷・本番の URL・Discord の本番の戻り先・バックアップ先）。雛形は [env.production.example](env.production.example)

だから、**この PC で開発（`bun run dev`）しても、実プリンターで印刷されず、Discord の戻り先は localhost のまま**。処理PC として動かす（`start-all.ps1`）と、本番の設定になる。

## いつでも使う：診断

```powershell
.\infra\windows\check-processing-pc.ps1            # この PC は、処理PC として動かせるか（何も変更しない。管理者でなくてよい）
.\infra\windows\check-processing-pc.ps1 -Public    # 加えて、公開の URL（インターネット経由）へ、実際につないで確かめる
```

足りないものと、直し方が、一覧で出る（OK／注意／NG）。NG があれば、終了コード 1。PC を替えたとき・当日の前・不具合のときに、まず、これを実行する。

## この PC を、処理PC にする（初回）

管理者の PowerShell で、リポジトリの直下から。

```powershell
.\infra\windows\setup-processing-pc.ps1 -DryRun     # 何をするかを、先に見る
.\infra\windows\setup-processing-pc.ps1             # ツール・ビルド・自動起動・バックアップ先
.\infra\windows\setup-processing-pc.ps1 -Tunnel     # 上に加えて、トンネルをサービスにして起動する（来場者の通信が、この PC に向く）
```

指定したときだけ行うもの（影響が大きいので、既定では行わない）。

| 指定 | すること | いつ |
| --- | --- | --- |
| `-Tunnel` | Cloudflare のトンネルを Windows サービスにして起動 | 来場者の通信を、この PC に向けるとき。**ほかの PC が、同じトンネルにつながっていないこと** |
| `-ConfigurePower` | スリープ・画面ロック・自動再起動をしない設定にする | **当日の直前**（リハーサルの前）。それまでは、普段の設定のまま |
| `-StartNow` | Caddy・api・print-worker を、いま起動する | 指定しなければ、次のログオンで起動する |

- 電源の設定を、元に戻す：`.\infra\windows\restore-power-settings.ps1`（変える前の値を、`%ProgramData%\canbadge\power-before.json` に保存してある）
- `-User` で、自動起動に使うユーザーを指定できる（既定は、実行しているユーザー）
- そのほかに、手作業で残るもの：自動ログオン（Autologon）・Windows Update の一時停止・BIOS の設定（[processing-pc.md](processing-pc.md) の手順 5〜6）

## PC を替える（古い PC → 新しい PC）

**注文が止まっていない時間に行う**（受付を「ビジー」にしてから）。トンネルを、2 台の PC が、同時につなぐと、注文が 2 台の DB に分かれるので、**古い PC を止めてから、新しい PC をつなぐ**（手順 4 → 7）。

### 古い PC

1. 受付を「ビジー」にして、印刷待ちの注文が、なくなるのを待つ（または、処理が終わるまで待つ）
2. 持ち出す（USB メモリ・外付けドライブを、つなぐ）

   ```powershell
   .\infra\windows\export-processing-pc.ps1 -To E:\
   ```

   `E:\canbadge-move\` に、設定・トンネルの認証・データの最新のバックアップ・記録（`manifest.json`）ができる。**秘密が入っている**ので、USB は、人に渡さない。クラウド・メール・チャットに置かない

### 新しい PC

3. 準備：Git と Bun を入れる（`winget install Git.Git Oven-sh.Bun`）。そのあと、リポジトリを取得する

   ```powershell
   git clone https://github.com/sofken2/canbadge-order-system C:\canbadge
   cd C:\canbadge
   ```

4. **古い PC を止める**（管理者の PowerShell。古い PC で）

   ```powershell
   .\infra\windows\export-processing-pc.ps1 -To E:\ -RetireThisPc    # 手順 2 を、まだなら、これで兼ねられる
   ```

   トンネルのサービス・自動起動を止めて、無効にする。これで、来場者の通信は、どの PC にも、届かなくなる（短い間）
5. 取り込む（新しい PC）

   ```powershell
   .\infra\windows\import-processing-pc.ps1 -From E:\canbadge-move
   ```

   設定・トンネルの認証・データが入る。**`.env.production` の `PRINTER_NAME`・`BACKUP_DIR` を、新しい PC に合わせて直す**（この PC にあるプリンターの一覧が出る）
6. セットアップ（管理者の PowerShell）

   ```powershell
   .\infra\windows\setup-processing-pc.ps1 -StartNow
   ```
7. トンネルをつなぐ

   ```powershell
   .\infra\windows\setup-processing-pc.ps1 -Tunnel -SkipTools -SkipBuild
   ```
8. 確かめる

   ```powershell
   .\infra\windows\check-processing-pc.ps1 -Public
   ```

   NG が 0 で、公開の URL が OK なら、完了。**スマホで、来場者用を開き、1 件、試しに、注文から印刷まで通す**
9. 持ち出したフォルダ（USB の `canbadge-move`）を、消す。受付を「受付中」に戻す

### 新しい PC のプリンター

プリンターを、新しい PC につなぎ、Windows に登録する（[processing-pc.md](processing-pc.md) の 8-3）。そのあと、`bun run printers` で名前を確かめて、`.env.production` の `PRINTER_NAME` に書く。**較正（縦 0.997 など）は、プリンターごとの値**なので、別のプリンターなら、`bun run calibration --print` で測り直す（[apps/print-worker/CLAUDE.md](../apps/print-worker/CLAUDE.md)）。

## 戻す（古い PC を、また使う）

新しい PC のトンネルを止めてから（`Stop-Service Cloudflared`）、古い PC で、次を行う。

```powershell
Set-Service Cloudflared -StartupType Automatic; Start-Service Cloudflared
Enable-ScheduledTask -TaskName canbadge-start-all; Enable-ScheduledTask -TaskName canbadge-backup
```

データは、新しい PC で、増えている。戻すなら、新しい PC で、もう一度 export して、古い PC で import する（`-Force`）。

## つまずきやすい点

| 症状 | 原因と対処 |
| --- | --- |
| 診断に、「トンネルのつなぎ手が 2 台以上」と出る | 別の PC が、同じトンネルにつながっている。古い PC で `Stop-Service Cloudflared; Set-Service Cloudflared -StartupType Disabled` |
| 画面が、古い URL・古い Discord のボタンのまま | `.env.production` を書き換えたのに、ビルドし直していない。`bun run build`（設定ファイルの中身が変わると、キャッシュは使われない） |
| import が「すでにある」と飛ばす | 新しい PC に、すでに `.env` などがある。置き換えるなら `-Force`（元のものは `.bak-<時刻>` に退避される） |
| `restore` が「止まる」 | `data\app.db` がすでにある。置き換えるなら、api を止めて、`bun run restore <フォルダ> --force`（今の DB は退避される） |
| Access のログインが通らない | 新しい PC の時計がずれている（診断が見る）。トンネルの認証が、別のトンネルのもの |
| 新しい PC で印刷が、はがき・別のトレイ | プリンターの設定（用紙・トレイ）が、Windows の既定のまま。processing-pc.md の 8-3 |

## 前提・限界

- 新しい PC も、**Windows**（処理PC は、Windows の前提。SumatraPDF・タスクスケジューラ・サービス）
- 回線が要る：新しい PC への、`git clone`・`bun install`・ツールの取得
- データは、**バックアップの時点**のもの。持ち出しのあとに入った注文は、引き継がれない（だから、受付を止めてから行う）
- Cloudflare のダッシュボードの設定（Access・Turnstile・WAF）は、PC に結びついていないので、変えなくてよい
