# apps/api（REST API と SSE）

Hono on Bun。契約（`packages/shared`）の全エンドポイントを実装し、状態の変更は `packages/db` の遷移関数を呼ぶ。

## 構成

| パス | 内容 |
| --- | --- |
| `src/index.ts` | 起動。DB を開き、SSE の配信口を作り、ポート（`API_PORT`）で待ち受ける |
| `src/app.ts` | `createApp(deps)`。ルートの登録、失敗の形、`/api/health`（契約の外の疎通用） |
| `src/register.ts` | 契約の `endpoints` から全ルートを登録する。入力（params・query・body）と JSON の応答を、契約のスキーマで検証する |
| `src/handlers/` | エンドポイントごとの処理。`public.ts`（来場者）・`staff.ts`・`monitor.ts`・`sse.ts`・`archive.ts`（アーカイブ。来場者向けとスタッフ向け） |
| `src/order-flow.ts` | 来場者の注文の確定（回数の制限・受付・端末あたりの上限・Turnstile・注文の作成）。通常の注文と、作品からの注文が、**同じ処理を通る** |
| `src/views.ts` | DB のエンティティから、画面に返す形（`OrderView` など）を組み立てる |
| `src/errors.ts` | 例外を、契約の失敗の形（`{ error: { code, message } }`）と HTTP ステータスにする |
| `src/events.ts` | 操作ログ（AuditLog）から SSE イベントを作り、購読者に配る。数秒ごとに操作ログを読む（api 自身も print-worker も、同じ操作ログを通る） |
| `src/guard.ts` | スタッフ用・モニター用の API を、経路ごとに、使わせる・断る（A05）。判定は `origin.ts`、Access の JWT の検証は `access.ts` |
| `src/turnstile.ts`・`src/abuse.ts`・`src/rate-limit.ts` | 乱用対策（A06）。Turnstile のサーバー側の検証、IP ごとの回数の制限、照会の総当たり対策 |
| `src/origin.ts`・`src/access.ts` | 接続元の経路の判定（Cloudflare・localhost・LAN）、Cloudflare Access の JWT の署名検証（jose） |
| `src/discord.ts` | Discord のアイコンの取り込み（W08）：OAuth2 の許可画面の URL、トークンの交換、本人のアイコンの取得、トークンの失効。Discord への通信だけ（`fetch` を差し替えられる） |
| `src/images.ts`・`src/anon.ts` | 画像の検証・保存・サムネイル・配信・掃除（A02）、匿名トークンの Cookie |

## エンドポイントを足す・変えるとき

1. 先に `packages/shared` の `endpoints`（`src/api/endpoints.ts`）と入出力のスキーマを直す（契約オーナーのレビューが要る）
2. `src/handlers/` の該当ファイルにハンドラーを足す。`Handlers` の型が、契約の全エンドポイントを要求するので、足りなければ型のエラーになる
3. `contract.test.ts` に、そのエンドポイントを呼ぶ手順を足す。最後のテストが、契約の全エンドポイントを呼んだかを確かめる

## ルール

- **状態は、`packages/db` の遷移関数だけで変える。** ここで SQL の UPDATE を書かない
- **画面に返す形は、`views.ts` で項目を選んで作る。** 匿名トークン、スタッフ向けの確認コード、モニター向けの注文 ID を含めない。契約のスキーマでの検証が、含めていないことをもう一度確かめる
- 失敗は、`ApiException` か `DbError` を投げる。`message` は、画面にそのまま出せる日本語にする
- 外部からの入力（Cookie・multipart を含む）は検証する。JSON は契約のスキーマが検証するが、それ以外はハンドラーで検証する

## 画像（A02）

`src/images.ts`。ファイル名は、利用者の入力ではなく、サーバーが作る ID（ULID）にする。

- **検証**：容量（Setting.`imageMaxBytes`・超えたら 413）→ 先頭のバイトで形式を判定（PNG・JPEG のみ・415）→ **sharp で、実際に最後まで読めるか**を確かめる。先頭だけ正しい壊れた画像、途中で切れた画像、**小さなファイルが展開すると巨大になる画像（画像爆弾。5,000 万画素まで）**を、断る（415）
- **サムネイル**（`?size=thumb`）：長辺 256px 以内の WebP（透明は残る・拡大しない・向き（EXIF）は反映）。アップロードのときに作り、なければ配信のときに作る（同時に取りに来ても、1 回だけ作る。一時名で書いてから置き換える）。**作れなければ、元の画像を返す**（画面を壊さない）。保存先は `data/images/thumbs/`。作り直せるので、バックアップの対象外（`backup.ts` は、フォルダの中のファイルだけを写す）
- **配信**：`x-content-type-options: nosniff`・`cache-control: private, max-age=3600`（画像は、作ったあとで変わらない。共有の置き場には置かせない）
- **掃除**（`cleanupImages`・起動時と 5 分ごと）：次の画像を消す（spec.md 13.3）。**15 分たっても、どの注文にも使われない画像**（エディタで作業している間は、消えない）と、**失効した注文の画像**（ほかの有効な注文が同じ画像を使っていれば、消さない）。使っているかの判定は、`packages/db` の `listImagePathsInUse`。アーカイブ作品から作ったデザイン、どの明細にも結ばれていないデザインの画像は、消さない。名前の形が違うファイルには、触らない
  - **同期で行う**：使っている画像の一覧を読んでから消すまで、`await` をはさまない。注文を作る処理も、画像の存在の最終確認から注文の作成まで `await` がないので、**消えた画像で注文が作られることはない**。消えていれば、「もう一度アップロードしてください」（400）
  - バックアップには、消す前の画像が、残る（`backup.ts` は、増えた分だけ足す。消さない）。学祭のあとの、画像データの削除（保存期間・実行委員会の方針）は、バックアップも対象にする
- **sharp**：ネイティブの画像ライブラリ。Windows・Linux の、ビルド済みのものが、`bun install` で入る

## Discord のアイコンの取り込み（W08）

設定と実機での確認の手順は `infra/discord.md`。`DISCORD_CLIENT_ID`・`DISCORD_CLIENT_SECRET`・`DISCORD_REDIRECT_URI` が、3 つそろっているときだけ、取り込める（未設定なら、画面に戻して「使えません」）。

- `GET /api/discord/authorize`：`state`（乱数）を作り、**この端末の Cookie**（`discord_state`・HttpOnly・SameSite=Lax・`/api/discord` のみ・10 分）に入れて、Discord の許可画面（権限は `identify` のみ）へ 302。Discord から、リンクで戻ってくるので、Strict にはしない
- `GET /api/discord/callback`：`state` を Cookie と、**一定の時間で**照合（違えば、Discord へ何も聞かずに断る）。Cookie は、成功・失敗にかかわらず、ここで捨てる（使い切り）。code → トークン → 本人（`id`・`avatar`）→ `cdn.discordapp.com/avatars/<id>/<avatar>.png?size=1024`（動くアイコンも、静止画）→ **持ち込みの画像と同じ保存**（`saveUploadedImage`：容量・形式・読めるか・サムネイル）→ `/?imageId=<画像 ID>` へ 302
- 失敗は、`/?discordError=<理由>` へ 302（画面が、読んで、アドレスから消して、文を出す）：`denied`（拒否）・`state`（確認できない・期限切れ・code が使えない）・`no_avatar`・`image`（画像として使えない・容量）・`rate`（画像のアップロードと同じ回数の制限）・`unavailable`（Discord に届かない・設定がない・そのほか）
- **保存しないもの**：Discord のユーザー ID・名前・アクセストークン・code。使い終わったトークンは、Discord 側で失効させる。ログにも出さない（失敗の理由の種類だけを残す）。テストで、DB・データ置き場のバイト列に、残っていないことを確かめている
- Discord の応答から URL を組み立てるので、`id`（数字）・`avatar`（16 進数）の形だけを通す（パスの書き換えを防ぐ）
- この理由のコードは、契約（`packages/shared`）の外にある（契約のクエリは `code`・`state`・`error` だけ）。理由を、契約の列挙にするなら、契約オーナーへの提案になる

## アーカイブ（A04）

投稿 → 審査（承認・却下）→ 公開 → 非公開（通報への対応・作者の取り下げ）。仕様は spec.md 11 章。状態の変更は、`packages/db` の `transitionArchiveEntry` だけ（表は `packages/shared` の `archiveTransitions`）。

| 誰が | エンドポイント | 内容 |
| --- | --- | --- |
| 来場者 | `GET /api/archive` | 公開中の作品の一覧（新しい順・`before` で続き）。サムネイル・表示名だけ |
| 来場者 | `GET /api/archive/:entryId` | 詳細（大きい画像・編集データ）。**公開中の作品か、作者本人の作品だけ**（それ以外は 404）。`isMine` つき |
| 来場者 | `GET /api/my/archive` | 自分が投稿した作品と、いまの状態 |
| 来場者 | `POST /api/archive` | 投稿（審査待ち）。**同意 2 項目が true でなければ 400**（契約のスキーマと、db の両方で保証。日時は db が記録） |
| 来場者 | `POST /api/archive/:entryId/withdraw` | 作者の取り下げ（公開中 → 非公開）。作者以外は 404（作品があることも教えない） |
| 来場者 | `POST /api/archive/:entryId/report` | 通報（公開中の作品だけ） |
| 来場者 | `POST /api/archive/:entryId/order` | 作品をコピーして注文。**通常の注文と同じ処理**（`order-flow.ts`） |
| スタッフ | `GET /api/staff/archive` | 審査の一覧（状態で絞る。未対応の通報の件数・大きい画像つき） |
| スタッフ | `POST /api/staff/archive/:entryId/{approve,reject,hide}` | 承認・却下・非公開 |
| スタッフ | `GET /api/staff/archive/reports`・`POST .../reports/:reportId/resolve` | 通報の一覧・対応済み |

- **作者の判定は、匿名トークンの Cookie。** 作者の匿名トークンは、どの応答にも含めない（`views.ts` で項目を選ぶ。契約のスキーマの検証が、余計な項目を落とす）。テストで、公開・詳細・審査の応答に、トークンが無いことを確かめている
- **同意の記録**：`selfMade`・`allowOthersToOrder`（どちらも true のみ）と、同意した日時（`agreedAt`）を、作品に保存する
- **作品からの注文**：作品のデザインを、**同じ画像を共有する新しいデザイン**としてコピーし、元作品への参照（`sourceArchiveEntryId`）を持たせる。編集は、まだできない（W07。決まったら拡張）。注文を作るトランザクションの中で、**元作品が公開中か**を確かめる（Turnstile の確認の間に、非公開にされても、注文は作られない。確認のあとに、もう一度、見る）
- **非公開にしたとき**（スタッフの非公開・作者の取り下げ）：同じトランザクションで、その作品をコピーした、**支払い前（`submitted`）の注文を失効**させる（操作ログに `reason: archive_hidden`）。支払い済みの注文は、そのまま。その作品への、未対応の通報は、対応済みにする
- **乱用対策**：投稿・通報は、IP ごとの回数の制限（画像のアップロードと同じ枠）。**1 端末が持てる審査待ちは 3 件まで**（db が、トランザクションの中で数える）。作品からの注文は、通常の注文と同じ上限・受付状態・Turnstile
- **画像の掃除との連動**（A02）：審査待ち・公開中の作品の画像は、消さない。却下・非公開になった作品の画像は、15 分たてば消える（コピーの注文が生きている間は、同じ画像を使っているので、消えない）
- **「保留」**：状態は足していない（契約の変更になる）。審査待ちのまま残す（審査の一覧は、状態で絞れる）
- 画面（staff・web）は、定期的に取り直す（SSE の種類は、足していない）

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
