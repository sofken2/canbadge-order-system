# infra

処理PC で動かす Caddy・cloudflared の設定と、手順書を置く。
予備機でも、この手順どおりに進めれば同じ状態を再現できることを目標にする（spec.md 4章）。

| パス | 内容 |
| --- | --- |
| `caddy/Caddyfile` | 唯一の入口。ホスト名で来場者用・スタッフ用の画面（静的ファイル）に振り分け、`/api/*` を api に渡す |
| `cloudflared/config.example.yml` | 名前付きトンネルの設定の見本（実際の設定と認証ファイルはリポジトリに入れない） |
| `windows/install-cloudflared-service.ps1` | cloudflared を Windows サービスにする（管理者の PowerShell） |
| `windows/start-all.ps1`・`stop-all.ps1` | Caddy・api・print-worker を起動し、落ちたら再起動し続ける／全部止める |
| `windows/register-startup-task.ps1` | ログオン時に `start-all.ps1` を実行するタスクを登録する |
| `windows/configure-processing-pc.ps1` | 電源・ロック画面・自動再起動の設定（本番の処理PC でだけ） |
| `windows/install-tools.ps1` | Git・Bun・Caddy・cloudflared・SumatraPDF を入れる |
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
- [ ] I04: バックアップと復旧手順
