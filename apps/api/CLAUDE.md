# apps/api（REST API と SSE）

Hono on Bun。契約（`packages/shared`）の全エンドポイントを実装し、状態の変更は `packages/db` の遷移関数を呼ぶ。

## 構成

| パス | 内容 |
| --- | --- |
| `src/index.ts` | 起動。DB を開き、SSE の配信口を作り、ポート（`API_PORT`）で待ち受ける |
| `src/app.ts` | `createApp(deps)`。ルートの登録、失敗の形、`/api/health`（契約の外の疎通用） |
| `src/register.ts` | 契約の `endpoints` から全ルートを登録する。入力（params・query・body）と JSON の応答を、契約のスキーマで検証する |
| `src/handlers/` | エンドポイントごとの処理。`public.ts`（来場者）・`staff.ts`・`monitor.ts`・`sse.ts` |
| `src/views.ts` | DB のエンティティから、画面に返す形（`OrderView` など）を組み立てる |
| `src/errors.ts` | 例外を、契約の失敗の形（`{ error: { code, message } }`）と HTTP ステータスにする |
| `src/events.ts` | 操作ログ（AuditLog）から SSE イベントを作り、購読者に配る。数秒ごとに操作ログを読む（api 自身も print-worker も、同じ操作ログを通る） |
| `src/guard.ts` | スタッフ用・モニター用の API を、経路ごとに、使わせる・断る（A05）。判定は `origin.ts`、Access の JWT の検証は `access.ts` |
| `src/turnstile.ts`・`src/abuse.ts`・`src/rate-limit.ts` | 乱用対策（A06）。Turnstile のサーバー側の検証、IP ごとの回数の制限、照会の総当たり対策 |
| `src/origin.ts`・`src/access.ts` | 接続元の経路の判定（Cloudflare・localhost・LAN）、Cloudflare Access の JWT の署名検証（jose） |
| `src/images.ts`・`src/anon.ts` | 画像の保存と配信の最小限、匿名トークンの Cookie |

## エンドポイントを足す・変えるとき

1. 先に `packages/shared` の `endpoints`（`src/api/endpoints.ts`）と入出力のスキーマを直す（契約オーナーのレビューが要る）
2. `src/handlers/` の該当ファイルにハンドラーを足す。`Handlers` の型が、契約の全エンドポイントを要求するので、足りなければ型のエラーになる
3. `contract.test.ts` に、そのエンドポイントを呼ぶ手順を足す。最後のテストが、契約の全エンドポイントを呼んだかを確かめる

## ルール

- **状態は、`packages/db` の遷移関数だけで変える。** ここで SQL の UPDATE を書かない
- **画面に返す形は、`views.ts` で項目を選んで作る。** 匿名トークン、スタッフ向けの確認コード、モニター向けの注文 ID を含めない。契約のスキーマでの検証が、含めていないことをもう一度確かめる
- 失敗は、`ApiException` か `DbError` を投げる。`message` は、画面にそのまま出せる日本語にする
- 外部からの入力（Cookie・multipart を含む）は検証する。JSON は契約のスキーマが検証するが、それ以外はハンドラーで検証する
- 画像の検証・サムネイル・期限切れの削除（A02）は、そのタスクで入れる。ここにあるのは最小限

## スタッフ認証（A05）

`/api/staff/*` と `/api/monitor/*` は、接続元の経路で扱いが変わる（`guard.ts`）。

| 経路 | スタッフ用 | モニター用 |
| --- | --- | --- |
| Cloudflare 経由（`cf-ray`・`cf-connecting-ip` がある） | `Cf-Access-Jwt-Assertion` の署名・発行者・aud・期限を検証して通す。なければ 401 | 401 |
| その PC の中（localhost） | 通す | 通す |
| 会場の LAN など、その PC の外 | 401（PIN 認証は、優先度を下げた機能で、未実装） | 401 |

- **ヘッダーがあるだけでは通さない。** 署名は、Cloudflare の公開鍵（`https://<チーム>.cloudflareaccess.com/cdn-cgi/access/certs`）で検証する（jose。キャッシュされる）。取得に失敗したら、断る（開けっぱなしにしない）
- `CF_ACCESS_TEAM_DOMAIN`・`CF_ACCESS_AUD` が未設定なら、Cloudflare 経由のスタッフ用は、すべて断る。起動時に警告が出る
- Caddy 経由のとき、api への接続は常に localhost になる。そのため、Caddy が付ける `X-Forwarded-For` の**いちばん右**（実際の接続元）も見る。左側は、クライアントが偽れるので、見ない
- 断るときの文には、認証の仕組みの詳細を出さない。理由は、api のログにだけ残る
- 認証を自作しない。署名の検証は、jose に任せる

## 乱用対策（A06）

来場者向けの API（認証なし）を、いたずらと機械的な連打から守る。

| 対象 | 対策 | 返すもの |
| --- | --- | --- |
| 注文の作成 | **Turnstile のトークンを、サーバーで検証する**（`turnstile.ts`）。`TURNSTILE_SECRET_KEY` が未設定のときだけ、検証しない（開発用。起動時に警告） | 失敗：400 `VALIDATION_FAILED`。Cloudflare に届かない・シークレットの誤り：500（通さない） |
| 注文の作成 | 受付が `open` でなければ断る（db のトランザクションの中でも、もう一度確かめる） | 503 `NOT_ACCEPTING` |
| 注文の作成 | 1 端末（匿名トークン）あたりの支払い待ちの上限（Setting.`maxPendingPerDevice`）。**db が、注文を作るトランザクションの中で数える**ので、同時に出されても超えない | 429 `RATE_LIMITED` |
| 注文の作成・画像のアップロード | IP ごとの回数の制限（`abuse.ts` の `LIMITS`）。学内の NAT で、同じ IP を多くの人が使うので、ゆるく取る | 429 `RATE_LIMITED` と `Retry-After` |
| 注文の照会 | IP ごとの回数に加え、**確認コードの失敗を、IP ごとと注文番号ごとに数える**。確認コードは 4 文字（31⁴ 通り）なので、総当たりを止める | 429 `RATE_LIMITED` と `Retry-After` |

- **Turnstile のトークンは 1 回しか使えない。** 受付停止・上限で断る注文では、先に断って、トークンを使わせない。失敗した注文は、画面（W02）が、Turnstile を作り直す
- 検証に失敗した理由（`timeout-or-duplicate` など）は、ログにだけ残し、画面には出さない
- 回数の制限は、メモリに持つ（api は 1 プロセス）。api を再起動すると、数え直しになる
- 来場者の IP は、Cloudflare 経由なら `cf-connecting-ip`、Caddy 経由なら `X-Forwarded-For` のいちばん右、直接なら接続元（`origin.ts` の `clientAddress`）
- テスト用のシークレット（Cloudflare 公式）：`1x0000000000000000000000000000000AA`（常に成功）・`2x0000000000000000000000000000000AA`（常に失敗）・`3x0000000000000000000000000000000AA`（トークンが使用済み）。サイトキーのテスト用は `1x00000000000000000000AA`（常に成功）

## SSE（A03）

SSE は、「変わった」ことだけを知らせる。受け取った画面が、REST で最新の状態を取り直す（取りこぼしても、つなぎ直したときに、全量を取り直せば、正しい状態に戻る）。購読は 3 種類：`/api/events/orders/:id`（来場者・自分の注文だけ）、`/api/staff/events`（スタッフ）、`/api/monitor/events`（呼び出しモニター・注文 ID を含まない）。

- **ハートビート**：20 秒ごとに、空のコメント行（`: ping`）を送る。Cloudflare は、100 秒データが流れない接続を切るので、それより十分に短くする。`SSE_HEARTBEAT_MS` で変えられる（短くするのは、確認用）
- 最初に、`: connected` と、つなぎ直しの待ち（`retry: 3000`）を送る。切れたあとは、ブラウザ（EventSource）が、3 秒後に、自動でつなぎ直し、画面が全量を取り直す
- **後始末**：接続が切れたら、購読とタイマーを、必ず片づける。ハートビートを送れなかった（相手の端末が、回線ごと消えた）接続も、そこで片づける（放っておくと、購読が溜まり続ける）
- **定期実行の頑丈さ**：操作ログを読む処理（数秒ごと）は、例外を外に出さない。print-worker が書き込み中で DB が一瞬使えないときに、api プロセス全体が落ちないように、ログに残して、次の巡回で続きから読む。1 つの接続への配信が失敗しても、ほかの接続には、届ける
- **接続の数の確認**：`GET /api/health` の `sseConnections`。接続が、溜まり続けていないかを、運用で見られる
- Caddy は、SSE をため込まない設定（`flush_interval -1`）。圧縮も、`/api` には、掛けない

## 試し方

- `bun run db:reset` でサンプルデータを入れてから `bun run dev`
- 開発サーバーは、その PC の中（localhost）からなので、認証なしでスタッフ用を使える。Cloudflare 経由・LAN から試したいときだけ、`.env` に `ALLOW_UNAUTHENTICATED_STAFF=1`（**本番では付けない**。付けると、起動時に警告が出る）
