# Cloudflare の設定手順（I03）

ドメイン `sofken2-ts.app` と名前付きトンネルは、[README の 4 章](README.md) で作成済みの前提。
ここでは、**トンネルの Windows サービス化・Access・Turnstile・WAF／レート制限・学内疎通の確認**を行う。

ダッシュボードの画面や名称は、Cloudflare の更新で変わることがある。迷ったら、項目名で検索する。
鍵とトークンは `.env` にだけ置く（コミットしない）。キー名は `.env.example` にある。

## 1. トンネルを Windows サービスにする

処理PC で、**管理者の PowerShell** から実行する。

```powershell
cd infra/windows
.\install-cloudflared-service.ps1
```

- ユーザーの設定と認証ファイルを、サービスが読む場所に複製してから登録する（スクリプトの冒頭に理由がある）
- 落ちたら 5 秒後に自動で再起動し、PC の起動時に始まる
- 起動の引数で設定とトンネルの実行を明示し、ログを `C:\ProgramData\cloudflared\cloudflared.log` に残す（登録直後のサービスは引数がなく、すぐ落ちるため）。落ちたときは、このログを見る
- 古いサービスが止まらないときは、スクリプトが 15 秒待ってからプロセスを終了させて、登録し直す
- 確認：`Get-Service Cloudflared` が `Running`。再起動して、手動起動なしで `https://badge.sofken2-ts.app/` が開く
- 設定を変えたら、スクリプトをもう一度実行する（複製し直して再登録する）
- Caddy の自動起動は I01 で行う。**トンネルより先に Caddy が動いている必要はない**（Caddy が止まっていると 502 が出るだけ）

## 2. スタッフ用ドメインに Access を掛ける

スタッフ用（`badge-staff.sofken2-ts.app`）は、Access を通った人だけが開けるようにする。Free プランで 50 人まで使える。

1. Cloudflare ダッシュボードの **Zero Trust**（初回はチーム名を決める。例：`sofken2-ts`。メモしておく）
2. **Access → Applications → Add an application → Self-hosted**
   - Application domain：`badge-staff.sofken2-ts.app`（パスは空。**サイト全体**を守る。`/api` も含む）
   - Session duration：当日の運営時間を覆う長さ（例：24 時間）
3. **Policy**：Action は **Allow**。Include は **Emails** で、スタッフのメールアドレスを登録する（学祭の担当者全員。人数が多いときは、ドメイン単位の指定ではなく個別に）
4. **Login methods**：**One-time PIN** を有効にする（メールに届くコードで入る。アカウント作成が不要）
5. 保存後、Application の **Audience (AUD) tag**（Overview）を控える

控えた値を、処理PC の `.env` に書く（A05 が JWT の署名を検証するのに使う）。

| `.env` のキー | 値 |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `<チーム名>.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | 上で控えた Audience tag |

確認：シークレットウィンドウで `https://badge-staff.sofken2-ts.app/` を開くと、メールの入力画面が出る。**登録していないメールアドレスではコードが届かない**こと、登録したメールで入れることを確かめる。

呼び出しモニター（S05）は、処理PC の 2 画面目で `http://staff.localhost:8080/monitor` を開く（Cloudflare を通らないので、Access のログインが要らない）。

## 3. Turnstile（来場者の注文確定のボット対策）

1. ダッシュボードの **Turnstile → Add widget**
   - Hostname：`badge.sofken2-ts.app`
   - Widget Mode：**Managed**
2. 発行された値を `.env` に書く。

| `.env` のキー | 値 | 使う人 |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | サイトキー（公開してよい） | W02（画面に埋め込む） |
| `TURNSTILE_SECRET_KEY` | シークレットキー（**秘密**） | A06（サーバーで検証する） |

開発で試すときは、Cloudflare が公開しているテスト用のキー（常に成功するもの）を `.env` に入れる。本番のキーは、本番の `.env` だけに置く。

## 4. WAF・レート制限

Free プランで使えるものだけを、有効にする。

1. **Security → WAF → Managed rules**：Free のマネージドルールセットを有効にする
2. **Security → WAF → Rate limiting rules**（Free は 1 ルールまで）：

| 項目 | 値 |
| --- | --- |
| 対象 | ホスト名が `badge.sofken2-ts.app` で、パスが `/api/` で始まるもの |
| 数える単位 | IP アドレス |
| しきい値 | 10 秒あたり 100 リクエスト |
| 超えたとき | Block（10 秒） |

- 学内の Wi-Fi は、多数の来場者が同じ IP になることがある。**しきい値は、Q02（実機通しテスト）で来場者の混み具合を見て調整する**。最初は緩め（上の値）にして、締めすぎない
- 注文確定（`POST /api/orders`）の乱用は、Turnstile と A06 の件数上限でも止める。ここだけで頑張らない

## 5. 学内ネットワークから疎通できることを確認する

**先に、大学のネットワーク利用規程を確認する**（spec.md 14.1）。トンネルが通らない、または規程に触れる場合は、大学側に相談する。

処理PC を、学祭で使う場所（学内ネットワーク）につないで確かめる。

| # | 確認 | 結果 |
| --- | --- | --- |
| 1 | `cloudflared tunnel info canbadge` で、接続が 4 本（またはそれ以上）出る | |
| 2 | 処理PC のブラウザで `https://badge.sofken2-ts.app/` が開く | |
| 3 | **学外**（スマホのモバイル回線）で、来場者用が開く | |
| 4 | **学内の Wi-Fi** につないだスマホで、来場者用が開く | |
| 5 | スタッフ用を学外で開くと、Access のログインが出る。登録外のメールでは入れない | |
| 6 | 登録したメールで入れて、スタッフ用ダミーページが開く | |
| 7 | 処理PC を再起動したあと、手動起動なしで 2 の URL が開く | |

トンネルの通信に使うポート（7844、TCP と UDP）が学内で塞がれていると、2 が失敗する。その場合は、`cloudflared` の設定で `protocol: http2`（TCP 443 を使う）に変えると通ることがある。

## 完了の目安

- [ ] トンネルが Windows サービスで、再起動後も自動で起動する
- [ ] スタッフ用に Access が掛かっていて、登録外のメールでは入れない
- [ ] `.env` に `CF_ACCESS_TEAM_DOMAIN`・`CF_ACCESS_AUD`・`TURNSTILE_SITE_KEY`・`TURNSTILE_SECRET_KEY` を入れた
- [ ] WAF のマネージドルールとレート制限が有効
- [ ] 学内のネットワークから、来場者用が開く（5 章の表）

## 引き継ぎ

- A05（スタッフ認証）：`CF_ACCESS_TEAM_DOMAIN`・`CF_ACCESS_AUD` を使って、`Cf-Access-Jwt-Assertion` の署名を検証する
- A06（乱用対策）・W02：Turnstile のキーを使う
