# infra

処理PC で動かす Caddy・cloudflared の設定と、手順書を置く。
予備機でも、この手順どおりに進めれば同じ状態を再現できることを目標にする（spec.md 4章）。

| パス | 内容 |
| --- | --- |
| `caddy/Caddyfile` | 唯一の入口。ホスト名で来場者用・スタッフ用に振り分け、`/api/*` を api に渡す |
| `caddy/dummy/` | app ができるまでの仮のページ（来場者用・スタッフ用） |

## いまの状態

app（T01 以降）がまだないので、Caddy がダミーページを直接返している。

| 経路 | 返すもの |
| --- | --- |
| `http://localhost:8080/` | 来場者用のダミーページ |
| `http://staff.localhost:8080/` | スタッフ用のダミーページ |
| `/api/*` | 仮の JSON（`{"status":"dummy",...}`） |

T01 で各 app のポートが決まったら、`Caddyfile` の `file_server` と `respond` を `reverse_proxy` に差し替える。

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

`Caddyfile` はダミーページの場所を相対パスで指しているので、**必ず `infra/caddy` に移動してから** 起動する。

```powershell
cd infra/caddy
caddy validate --config Caddyfile --adapter caddyfile   # 設定の検証
caddy run --config Caddyfile --adapter caddyfile        # 起動（Ctrl+C で停止）
```

ブラウザで `http://localhost:8080/` と `http://staff.localhost:8080/` を開き、それぞれのダミーページに「API: OK (dummy)」と出れば成功。

環境変数で変えられる値:

| 変数 | 既定値 | 内容 |
| --- | --- | --- |
| `CADDY_PORT` | `8080` | 待ち受けポート |
| `STAFF_HOST` | `staff.localhost` | スタッフ用のホスト名。本番では `staff.<ドメイン>` |

## 3. 仮 URL で外部に公開する（動作確認用）

Cloudflare のアカウントもドメインもなしで、一時的な URL を発行できる。Caddy を起動したまま、別のターミナルで実行する。

```powershell
cloudflared tunnel --url http://localhost:8080
```

出力に `https://<ランダムな文字列>.trycloudflare.com` が表示される。スマホなどからその URL を開き、来場者用のダミーページが出れば成功。Ctrl+C で止めると URL は無効になる。

注意:

- URL を知っていれば誰でも開ける。確認が終わったら止める
- URL は起動するたびに変わる。ホスト名を固定できないので、スタッフ用のページは仮 URL からは開けない（来場者用だけが出る）
- 本番では使わない。本番は独自ドメインと名前付きトンネルを使う（I03）
- 学内ネットワークで使う前に、大学のネットワーク利用規程を確認する（spec.md 14.1）

## 残っている作業

- [ ] I02: app への `reverse_proxy`、SSE がため込まれずに届くことの確認、LAN 経由時の PIN 認証（優先度低）
- [ ] I03: 独自ドメイン、名前付きトンネルと Windows サービス化、Access、Turnstile、WAF・レート制限
- [ ] I01: 処理PC の自動ログオン・自動起動・Windows Update 停止・スリープ無効化
- [ ] I04: バックアップと復旧手順
