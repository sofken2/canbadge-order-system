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

1. Cloudflare ダッシュボードの **Zero Trust**（初回はチーム名を決める。このプロジェクトは `sofken2`。チーム名とドメインは **Settings** で確認できる）
2. **Access → Applications → Add an application → Self-hosted**
   - 入口は「Private IP」ではなく、**Add public hostname** を使う（URL が `destination=private-ip` の画面に入ったら、そこで「Add public hostname」を押す）
   - Application domain：`badge-staff.sofken2-ts.app`（パスは空。**サイト全体**を守る。`/api` も含む）
   - Session duration：当日の運営時間を覆う長さ（例：24 時間）
3. **Policy**：Action は **Allow**。Include は **Emails** で、スタッフのメールアドレスを登録する（学祭の担当者全員。人数が多いときは、ドメイン単位の指定ではなく個別に）
4. **One-time PIN**：メールに届くコードで入る方式（アカウント作成が不要）。**Zero Trust → Integrations → Identity providers** で有効にし、アプリの「Accepted identity providers」でも選ぶ。選ばないと、ログイン方法が「Cloudflare」（Cloudflare アカウント）だけになり、スタッフは入れない
5. 保存後、Application の **Audience (AUD) tag**（Overview）を控える

控えた値を、処理PC の `.env` に書く（api が、Access の JWT の署名を検証するのに使う）。**書かないと、スタッフ用の画面は、Cloudflare 経由では、すべて「使えません」になる**（開けっぱなしには、しない）。

| `.env` のキー | 値 |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `sofken2.cloudflareaccess.com`（Settings の Team domain の値。ログイン画面に出る別のドメインではない） |
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
| `TURNSTILE_SECRET_KEY` | シークレットキー（**秘密**） | A06（api がサーバーで検証する）。**未設定だと、検証されない**（開発用。api の起動時に警告が出る） |

開発で試すときは、Cloudflare が公開しているテスト用のキー（常に成功するもの）を `.env` に入れる。本番のキーは、本番の `.env` だけに置く。

## 4. WAF・レート制限

Free プランで使えるものだけを、有効にする。

- Managed rules は、Free プランでは使えない（画面にそう出る）。この手順では使わない
- **Security → WAF → Rate limiting rules**（Free は 1 ルールまで）。「Edit expression」に次の式を入れると確実：
  `(http.host eq "badge.sofken2-ts.app" and starts_with(http.request.uri.path, "/api/"))`

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
| 6 | 登録したメールで入れて、スタッフ用の画面が開く | |
| 7 | 処理PC を再起動したあと、手動起動なしで 2 の URL が開く | |

トンネルの通信に使うポート（7844、TCP と UDP）が学内で塞がれていると、2 が失敗する。その場合は、`cloudflared` の設定で `protocol: http2`（TCP 443 を使う）に変えると通ることがある。

## つまずきやすい点

- **ポリシーを2つ作ってしまう**：新しい画面では、ポリシーが別の一覧（Access → Policies）にある。「Used by applications」が 0 のものは、どこにも効いていない。メールを足すのは、使われているほう
- **コードが届かない**：登録外のメールでも「コードを送った」と表示される（仕様）。ポリシーに載っているか、迷惑メールを確認する。Access のログには、コードを入力するまで何も出ない
- **スタッフ用が 502**：Caddy が止まっている。`STAFF_HOST` を渡して起動する（README 4-2）

## 完了の目安

- [ ] トンネルが Windows サービスで、再起動後も自動で起動する
- [ ] スタッフ用に Access が掛かっていて、登録外のメールでは入れない
- [ ] `.env` に `CF_ACCESS_TEAM_DOMAIN`・`CF_ACCESS_AUD`・`TURNSTILE_SITE_KEY`・`TURNSTILE_SECRET_KEY` を入れた
- [ ] レート制限のルールが有効
- [ ] 学内のネットワークから、来場者用が開く（5 章の表）

## 引き継ぎ

- A05（スタッフ認証）：実装済み。`CF_ACCESS_TEAM_DOMAIN`・`CF_ACCESS_AUD` で、`Cf-Access-Jwt-Assertion` の署名を検証する（`apps/api/CLAUDE.md`）。公開前の確認は、下の「A05 の確認」
- A06（乱用対策）：実装済み。`TURNSTILE_SECRET_KEY` で、注文のトークンをサーバーで検証する。端末あたりの支払い待ちの上限・IP ごとの回数の制限・照会の総当たり対策もある（`apps/api/CLAUDE.md`）。公開前の確認は、下の「A06 の確認」
- W02：`TURNSTILE_SITE_KEY` を使う

## A05 の確認（公開前）

処理PC の `.env` に `CF_ACCESS_TEAM_DOMAIN`・`CF_ACCESS_AUD` を書き、api を起動し直してから確かめる（api の起動時に、未設定の警告が出ていないこと）。

| # | 確認 | 期待 |
| --- | --- | --- |
| 1 | 登録したメールで、`https://badge-staff.…/` にログインして、レジ・設定の画面を開く | 開ける。操作もできる |
| 2 | ログインせずに、`https://badge-staff.…/api/staff/settings` を開く | Access のログイン画面（API には届かない） |
| 3 | 来場者用のアドレス（`https://badge.…/api/staff/settings`）を開く | 401 |
| 4 | 処理PC の `http://staff.localhost:8080/monitor` | 番号が出る |
| 5 | 来場者用のアドレスで `…/api/monitor/ready` | 401 |
| 6 | 会場の LAN の別の端末から `http://<処理PC の IP>:8080/api/staff/settings` | 401（PIN 認証は未実装。スタッフは、Cloudflare 経由で使う） |

**`ALLOW_UNAUTHENTICATED_STAFF=1` を、本番の `.env` に書かないこと**（書くと、認証なしで、すべての経路から使える。api の起動時に警告が出る）。

## A06 の確認（公開前）

処理PC の `.env` に `TURNSTILE_SECRET_KEY`（本番のシークレット）を書き、api を起動し直してから確かめる（api の起動時に、`TURNSTILE_SECRET_KEY が未設定` の警告が出ていないこと）。

| # | 確認 | 期待 |
| --- | --- | --- |
| 1 | 来場者用のアドレスで、デザインを作って注文する | 注文できる（Turnstile が通る） |
| 2 | 同じスマホで、支払い前の注文を、もう 1 件出し、さらにもう 1 件出す（上限は、既定 2 件） | 3 件目は「支払い待ちの注文が 2 件あります。…」と出て、断られる |
| 3 | 1 件を取り消してから、もう一度注文する | 注文できる |
| 4 | curl などで、Turnstile のトークンを付けずに（または、でたらめな値で）`POST /api/orders` を呼ぶ | 400 で断られる |
| 5 | スタッフ画面で受付を「ビジー」にして、来場者用で注文する | 「混雑のため…」と出て、断られる |
| 6 | 注文照会で、確認コードを、10 回ほど、わざと間違える | 「確認コードを、何度も間違えています。…ほど待って…」と出て、止まる |

WAF・レート制限（4 章）は、入口で過剰なアクセスを止める。api の回数の制限（IP ごと）は、その内側の備えで、**学内の NAT で多くの人が同じ IP になっても、困らない**ゆるさにしてある。
