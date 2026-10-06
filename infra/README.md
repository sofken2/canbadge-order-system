# infra

処理PC で動かす Caddy・cloudflared の設定と、手順書を置く。
予備機でも、この手順どおりに進めれば同じ状態を再現できることを目標にする（spec.md 4章）。

| パス | 内容 |
| --- | --- |
| `caddy/Caddyfile` | 唯一の入口。ホスト名で来場者用・スタッフ用の画面（静的ファイル）に振り分け、`/api/*` を api に渡す |
| `anubis/botPolicies.yaml` | Anubis（ボット対策）の方針。来場者用の画面（HTML）に、計算の問題を解いてもらう |
| `cloudflared/config.example.yml` | 名前付きトンネルの設定の見本（実際の設定と認証ファイルはリポジトリに入れない） |
| `windows/install-anubis.ps1` | Anubis を、公式リリースから取り、ハッシュを確かめて `data\tools\anubis\` に置く |
| `windows/install-cloudflared-service.ps1` | cloudflared を Windows サービスにする（管理者の PowerShell） |
| `windows/start-all.ps1`・`stop-all.ps1` | Caddy・api・print-worker を起動し、落ちたら再起動し続ける／全部止める |
| `windows/register-startup-task.ps1` | ログオン時に `start-all.ps1` を実行するタスクを登録する |
| `windows/configure-processing-pc.ps1` | 電源・ロック画面・自動再起動の設定（本番の処理PC でだけ） |
| `windows/install-tools.ps1` | Git・Bun・Caddy・cloudflared・SumatraPDF を入れる |
| `windows/run-backup.ps1`・`register-backup-task.ps1`・`check-backup.ps1` | バックアップを 1 回取る／数分おきに取るタスクの登録／取れているかの確認 |
| `backup.md` | バックアップと、予備機での復旧・リハーサルの手順（I04） |
| `processing-pc.md` | 処理PC の構築手順（専用ユーザー・自動ログオン・自動起動・Windows Update）（I01） |
| `cloudflare.md` | サービス化・Access・Turnstile・WAF／レート制限・学内疎通の確認の手順（I03） |

## いまの状態

Caddy が、ホスト名で画面（ビルドした静的ファイル）を振り分け、`/api/*` を api に渡す。画面は、起動前に `bun run build` で作っておく（`apps/web/dist`・`apps/staff/dist`）。

| 経路 | 返すもの |
| --- | --- |
| `http://localhost:8080/` | 来場者用の画面（`/orders/<ID>` のようなパスも、画面側で振り分ける） |
| `http://staff.localhost:8080/` | スタッフ用の画面（常にスタッフ用。その PC の中からしか開けない） |
| `/api/*`（どちらのホスト名でも） | api（既定のポート 3002）に転送。SSE はため込まずにすぐ流す |
| `https://badge.sofken2-ts.app/` | 来場者用の画面（独自ドメイン、トンネル経由） |
| `https://badge-staff.sofken2-ts.app/` | スタッフ用の画面（Access のログインが先に出る） |

確認したこと：SSE（`/api/staff/events`）は、Caddy 経由で、接続が 70ms 以内、状態変更のイベントが、api の巡回間隔（2 秒）どおりに届く。Caddy による遅れはない。

## Anubis（ボット対策・任意）

[Anubis](https://anubis.techaro.lol/) は、来場者用の画面の入口で、ブラウザのふりをするボットを選ぶ。最初の 1 回だけ、「あなたがボットでないことを確認しています」の画面が出て、ブラウザが小さな計算の問題を解く（既定の難しさで、手元の Chrome では 1 秒ほど）。通ったブラウザは、1 週間、確認なしで使える。**既定は使わない。**

```
来場者 → Caddy ─┬─ /api/*・/assets/* ──────────────→ api・静的ファイル（Anubis を通らない）
                └─ そのほか（HTML）→ Anubis → Caddy（内部サイト 127.0.0.1:8081）→ 来場者用の画面
```

- 守るのは、来場者用の画面の **HTML だけ**。`/api/*` は JSON を返すので、確認の画面が返ると画面が壊れる。注文そのものを守るのは Turnstile（W02・A06）で、Anubis は、その手前でボットを減らす
- スタッフ用（`staff.*`・`staff.localhost`）と呼び出しモニターは、通らない
- 使うとき（処理PC）：

```powershell
powershell -ExecutionPolicy Bypass -File infra\windows\install-anubis.ps1   # 初回だけ。data\tools\anubis\anubis.exe に置く
```

`.env` に `ANUBIS_ENABLED=1` と、署名鍵 `ANUBIS_ED25519_PRIVATE_KEY_HEX` を書いて（`.env.example` に作り方）、`start-all.ps1` を起動し直す。Anubis も、Caddy・api と同じく、落ちたら再起動される。方針は `infra/anubis/botPolicies.yaml`（AI のクローラーは断り、ブラウザには問題を出し、`curl` などは通す）。
- **確認したこと**：Chrome で、確認の画面 → 約 1.3 秒で画面が出る／確認済みの 2 回目は確認なしで 0.2 秒／`/api` は確認なしで届く／`GPTBot` は断られる／`curl` は通る／Anubis を切ると、これまでどおり
- **未確認**：実機のスマホでの待ち時間、Cloudflare 経由での `Cf-Connecting-Ip`（来場者の IP として使う）、LINE などアプリ内ブラウザでの動き
- 難しすぎると、古いスマホで待たされる。`ANUBIS_DIFFICULTY`（既定 4）を上げ下げして調整する

LAN 経由の PIN 認証は、優先度を下げた機能なので実装していない（CLAUDE.md）。

## 1. インストール（Windows）

```powershell
winget install --id CaddyServer.Caddy -e
winget install --id Cloudflare.cloudflared -e
```

インストール後はターミナルを開き直す（PATH を反映するため）。

```powershell
caddy version
cloudflared --version
```

動作を確認した版: Caddy v2.11.4、cloudflared 2026.9.3

## 2. Caddy を起動する

`Caddyfile` は画面の場所を相対パスで指しているので、**必ず `infra/caddy` に移動してから** 起動する。先に、画面と api を用意する。

```powershell
bun run build                                   # リポジトリの直下で。apps/web/dist と apps/staff/dist ができる
bun --env-file=.env.example --env-file=.env apps/api/src/index.ts   # api（別のターミナルで）
```

```powershell
cd infra/caddy
caddy validate --config Caddyfile --adapter caddyfile   # 設定の検証
caddy run --config Caddyfile --adapter caddyfile        # 起動（Ctrl+C で停止）
```

ブラウザで `http://localhost:8080/`（来場者用）と `http://staff.localhost:8080/`（スタッフ用）を開き、画面が出れば成功。`/api/status` が JSON を返すことも確認する。

環境変数で変えられる値:

| 変数 | 既定値 | 内容 |
| --- | --- | --- |
| `CADDY_PORT` | `8080` | 待ち受けポート |
| `STAFF_HOST` | `staff.localhost` | スタッフ用のホスト名。本番では `badge-staff.<ドメイン>`。`staff.localhost` は、これに関係なく常にスタッフ用 |
| `API_PORT` | `3002` | api のポート（`.env.example` と同じ） |
| `WEB_DIST`・`STAFF_DIST` | `../../apps/web/dist`・`../../apps/staff/dist` | 画面の場所（`Caddyfile` からの相対） |

## 3. 仮 URL で外部に公開する（動作確認用）

Cloudflare のアカウントもドメインもなしで、一時的な URL を発行できる。Caddy を起動したまま、別のターミナルで実行する。

```powershell
cloudflared tunnel --url http://localhost:8080
```

出力に `https://<ランダムな文字列>.trycloudflare.com` が表示される。スマホなどからその URL を開き、来場者用の画面が出れば成功。Ctrl+C で止めると URL は無効になる。

注意:

- URL を知っていれば誰でも開ける。確認が終わったら止める
- URL は起動するたびに変わる。ホスト名を固定できないので、スタッフ用のページは仮 URL からは開けない（来場者用だけが出る）
- 本番では使わない。本番は独自ドメインと名前付きトンネルを使う（I03）
- 学内ネットワークで使う前に、大学のネットワーク利用規程を確認する（spec.md 14.1）

## 4. 独自ドメインと名前付きトンネル（本番の公開方法）

ドメイン: `sofken2-ts.app`（GitHub 学生特典で Name.com で取得。ネームサーバーは Cloudflare）。`.app` は HTTPS でしか開けないが、Cloudflare が証明書を自動で用意する。ホスト名は次の2つ。

| ホスト名 | 用途 |
| --- | --- |
| `badge.sofken2-ts.app` | 来場者用 |
| `badge-staff.sofken2-ts.app` | スタッフ用。`staff.badge.～` のように2段にしないのは、無料プランの証明書が1段目までしか対象にしないため |

### 4-1. 最初に1回だけ（管理者）

1. Cloudflare でアカウントを作り、ドメインを追加して Free プランを選ぶ。表示されたネームサーバー2つを、Name.com の Manage Nameservers に設定する
2. Cloudflare が取り込んだ仮の DNS レコード（A レコード）は消す。Name.com の仮ページを指しているため
3. `cloudflared tunnel login` を実行し、ブラウザでドメインを選んで許可する（`%USERPROFILE%\.cloudflared\cert.pem` ができる）
4. トンネルを作り、2つのホスト名を向ける

```powershell
cloudflared tunnel create canbadge
cloudflared tunnel route dns canbadge badge.sofken2-ts.app
cloudflared tunnel route dns canbadge badge-staff.sofken2-ts.app
```

5. `cloudflared/config.example.yml` を `%USERPROFILE%\.cloudflared\config.yml` にコピーし、`<トンネルID>` と `<ユーザー名>` を置き換える。`cloudflared tunnel ingress validate` で検証する

`<トンネルID>.json`（認証ファイル）と `cert.pem` は秘密情報。コミットしない。処理PC に移すときは、安全な方法で渡す。

### 4-2. 起動する

Caddy にスタッフ用のホスト名を環境変数で渡して起動し、別のターミナルでトンネルを起動する。

```powershell
cd infra/caddy
$env:STAFF_HOST = "badge-staff.sofken2-ts.app"
caddy run --config Caddyfile --adapter caddyfile
```

```powershell
cloudflared tunnel run canbadge
```

`https://badge.sofken2-ts.app/` と `https://badge-staff.sofken2-ts.app/` を開き、それぞれの画面が出れば成功（スタッフ用は、Access のログインが先に出る）。

### 4-3. つまずいたとき

| 症状 | 対処 |
| --- | --- |
| 片方のホスト名だけ `ERR_SSL_UNRECOGNIZED_NAME_ALERT` になる | Cloudflare の DNS 画面でそのホスト名のレコードを削除し、`cloudflared tunnel route dns canbadge <ホスト名>` で作り直す（`--overwrite-dns` では直らなかった） |
| `502` が出る | Caddy が起動していない、または api が起動していない（`/api/*` だけが 502 なら api）。先に起動する |
| 画面が 404 になる | `bun run build` をしていない（`apps/web/dist`・`apps/staff/dist` がない） |
| `cloudflared tunnel route dns` が赤いエラー表示になる | PowerShell が出力を誤って表示しているだけのことがある。`Added CNAME` と出ていれば成功 |

## 残っている作業

- [x] I02: ホスト名での振り分け、`/api` の転送、SSE がため込まれずに届くことの確認（LAN 経由時の PIN 認証は優先度低なので未実装）
- [x] I03（一部）: 独自ドメイン、名前付きトンネル（手動起動）
- [ ] I03: トンネルの Windows サービス化、Access（スタッフ画面のログイン）、Turnstile、WAF・レート制限、学内ネットワークからの疎通確認（手順は [cloudflare.md](cloudflare.md)。ダッシュボードの操作と実機での確認は管理者が行う）
- [ ] I01: 処理PC の自動ログオン・自動起動・Windows Update 停止・スリープ無効化（スクリプトと手順書は [processing-pc.md](processing-pc.md)。本番の処理PC での実施と確認が残っている）
- [ ] I04: バックアップと復旧手順（実装と手順書は [backup.md](backup.md)。本番の処理PC での定期実行の登録と、予備機での復旧リハーサルが残っている）
