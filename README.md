# canbadge-order-system

学祭のオリジナル缶バッジ注文・印刷・呼び出しシステム。

来場者がスマホでバッジをデザインして注文し、ブースで支払う。処理PCが自動で面付け・印刷し、スタッフが組み立てて番号で呼び出す。学祭まで約1ヶ月のため、**期日までに動くものを出すことが最優先**。

| 資料 | 内容 |
| --- | --- |
| [docs/setup.md](docs/setup.md) | 環境構築、日々の作業の流れ、Claude Code の使い方 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | PR を出すまでの流れと、守ること（最小限のルール） |
| [docs/spec.md](docs/spec.md) | 仕様書（構成・状態遷移・データモデル） |
| [docs/tasks.md](docs/tasks.md) | タスク一覧と解説。「全体のつながり」の章にデータの形と API の叩き台がある |
| [Issues](https://github.com/sofken2/canbadge-order-system/issues) | タスク1件 = Issue 1件。タイトル先頭が tasks.md の ID |
| [Projects ボード](https://github.com/orgs/sofken2/projects/3) | 未着手 / 作業中 / レビュー待ち / 完了 |

## 参加する開発者へ

### はじめにやること

1. [docs/setup.md](docs/setup.md) の第2部で環境を作る
2. [docs/spec.md](docs/spec.md) の 1〜8 章をざっと読む（全体像・識別子・業務フロー・状態遷移）
3. [docs/tasks.md](docs/tasks.md) の「全体のつながり」を読む。どのパッケージが何を渡し合うかが分かる
4. Projects ボードの「未着手」からタスクを選ぶ。初めてなら `good first issue` ラベルが付いたものがおすすめ

### 今の進み具合

フェーズ0（T01〜T10：モノレポ・契約・DB・API の骨組みとデザインの土台）が終わるまで、フェーズ1のアサインは始めない。T09・T10 が完了したらフェーズ1の開始を案内する。

フェーズ0の間でも着手できるもの：

- インフラ（I01〜I04）。コードに依存しない。特に I03（大学への確認）は早いほど良い
- 実機の確認（S01 のカメラ、P03 のプリンター）の下調べ

### タスクの選び方と進め方

1. Issue に「やります」とコメントし、自分を Assignees に追加する
2. 管理者が依存関係を確認して承認したら、ボードで「作業中」に移す
3. ブランチを切る：`<種別>/<IssueID>-<短い説明>`（例: `feat/W03-order-status`）
4. 早めに Draft PR を出す。本文に `Closes #<Issue番号>` を書く
5. 完成したら `gh pr ready` で Draft を解除し、ボードで「レビュー待ち」に移す

同時に持てるのは 1〜2 件まで。詳しいコマンドは [docs/setup.md の第3部](docs/setup.md#第3部日々の作業の流れ) を参照。

### ラベル

| ラベル | 意味 |
| --- | --- |
| `web` `staff` `api` `print` `infra` `shared` | 担当する領域（下の表） |
| `初級` `中級` `上級` | 難易度 |
| `good first issue` | 初参加の人向け |
| `実機` | スマホ・プリンター・処理PC などの実機での検証が必要。早めに着手する |
| `優先度低` | 本筋が完成してから着手（アーカイブ一式、回線断テスト） |

### 構成と担当タスク

| パス | 役割 | ラベル | 主なタスク |
| --- | --- | --- | --- |
| `apps/web` | 来場者向け（エディタ・注文・注文状況） | `web` | W02〜W08 |
| `apps/staff` | スタッフ向け（レジ・印刷確認・組み立て・設定・モニター） | `staff` | S02〜S07 |
| `apps/api` | REST API と SSE（Hono on Bun） | `api` | T07、A01〜A06 |
| `apps/print-worker` | 面付け・PDF 生成・印刷 | `print` | P01〜P03 |
| `packages/shared` | 契約（zod スキーマ・ステータス・遷移表・API 型・SSE イベント型） | `shared` | T04 |
| `packages/db` | SQLite + Drizzle、状態遷移関数 | `shared` | T05 |
| `packages/fixtures` | 共通サンプルデータとシード | `shared` | T06 |
| `packages/badge-spec` | 寸法・解像度・面付けの設定値 | `shared` | T08、Q01 |
| `packages/ui` | デザイントークンと共通 UI 部品（`design.md` に従う）。いまは、読み込み・操作・画面遷移の React の小さな部品だけ | `shared` | T10 |
| `packages/api-client` | 型付きの API クライアント。契約の `endpoints` から作り、web・staff が `/api` を呼ぶのに使う | `shared` | T09 |
| `packages/e2e` | 通し確認。api と print-worker を実際に起動し、注文から受け渡しまでを通す（`bun run test` に含まれる） | `shared` | T09 |
| `packages/editor` | キャンバスエディタ | `web` | W01 |
| `packages/scanner` | カメラでの QR 読み取り | `staff` | S01 |
| `infra/` | Caddy・cloudflared 設定、Windows 起動スクリプト、手順書 | `infra` | I01〜I04 |

各タスクが何を使い、何を誰に渡すかは、[docs/tasks.md](docs/tasks.md) の各タスク解説の「つながり」と、各 Issue 本文に書いてある。

### 守ってほしいルール

詳しくは [CLAUDE.md](CLAUDE.md)。人が開発する場合も同じルールで進める。

- **型・ステータス・API の形は `packages/shared` にだけ定義する。** 画面や API 側で独自に定義しない。変えたいときは管理者（契約オーナー）に相談する
- **状態の変更は `packages/db` の遷移関数を通す。** status 列を直接 UPDATE しない
- **ダミーデータは `packages/fixtures` のものを使う。** 画面は最初から `apps/api` を呼ぶ
- **寸法は `packages/badge-spec` の mm 値を使い、px への換算は用意された関数を通す**
- **本番は Windows。** パスは `node:path` で組み立て、シェル固有のコマンドに依存しない
- **金額は円の整数で扱う**
- **画面の見た目は `design.md` と `packages/ui` のトークンに従う。** デザインのルールは Hallmark（[docs/spec.md 6.4](docs/spec.md)）。色や書体を画面ごとに決めない
- **秘密情報をコミットしない。** `.env` に置き、`.env.example` にキー名だけを書く
- `main` に直接 push しない。PR は Squash merge でマージされる

### コマンド

```sh
bun install          # 依存関係のインストール
bun run dev          # 全 app を開発モードで起動
bun run typecheck    # 型チェック（全パッケージ）
bun run lint         # lint（Biome）
bun run test         # テスト（bun test）
bun run build        # ビルド
bun run format       # コードの整形
bun run db:reset     # DB を作り直して、サンプルデータを入れる（data/ に作られる）
```

### 動かして試す

```sh
bun run db:reset     # サンプルデータを入れる（初回と、データを作り直したいとき）
bun run dev          # web・staff・api・print-worker を起動する
```

| 画面 | URL |
| --- | --- |
| 来場者：注文する | http://localhost:3000/ （注文すると、注文状況に移る） |
| 来場者：エディタ（確認用の仮画面） | http://localhost:3000/editor （`?sample=01J00000000000000000000001` で、サンプルの画像を最初の写真にできる） |
| スタッフ：レジ | http://localhost:3001/register |
| スタッフ：印刷確認 | http://localhost:3001/print |
| スタッフ：組み立て・受け渡し | http://localhost:3001/assemble |
| 呼び出しモニター | http://localhost:3001/monitor |
| スタッフ：設定（営業開始・受付状態・印刷の一時停止） | http://localhost:3001/settings |

画面は、すべて**仮のもの**（見た目は作っていない）。注文から呼び出しまでの流れは、次のとおり。

1. 来場者の画面で画像を選んで注文する → 注文番号と確認コードが出る
2. レジで注文番号を入れて、支払い済みにする
3. print-worker が、印刷待ちを拾って PDF を作り、開発用ドライバーが `data/print-out/` に出力する（サンプルは、待ち時間 10 秒）
4. 印刷確認の画面で、バッジごとに OK か再印刷を選んで確認する
5. 組み立て・受け渡しの画面で、組み立て開始 → 完成。呼び出しモニターに番号が出る
6. 受け渡しで、来場者の確認コードを入れて、受け渡し済みにする

- サンプルデータには、**確認待ちの印刷シートが 1 枚**入っている。印刷中のシートは同時に 1 枚までなので、新しい注文を印刷したいときは、先にそのシートを印刷確認で確認する
- `packages/` の変更は、`bun run dev` を再起動すると反映される（`bun --watch` は、各 app の外のファイルを監視しない）
- 通し確認：`bun run test` に、api と print-worker を実際に起動して、注文から受け渡しまでを通す確認（`packages/e2e`）が含まれる

PR を出す前に `typecheck`・`lint`・`test` を通す。特定のパッケージだけ実行するときは `bunx turbo run <task> --filter=@canbadge/<名前>`（例：`bunx turbo run test --filter=@canbadge/api`）。

`bun run dev` で起動すると、次の URL で開ける。

| app | URL | ポート（`.env` の変数） |
| --- | --- | --- |
| web（来場者向け） | http://localhost:3000/ | 3000（`WEB_PORT`） |
| staff（スタッフ向け） | http://localhost:3001/ | 3001（`STAFF_PORT`） |
| api | http://localhost:3002/api/health | 3002（`API_PORT`） |
| print-worker | なし（ターミナルに起動のログだけ出る） | — |

api は契約（`packages/shared`）の全エンドポイントを実装している。`bun run db:reset` でサンプルデータを入れてから `bun run dev` すると、サンプルの注文を返す（構成は `apps/api/CLAUDE.md`）。スタッフ用・モニター用の API は、認証（A05）ができるまで、Cloudflare を通ったリクエストを 401 で断る。

web と staff の画面は、`/api` を api のポートへ転送する。本番（Caddy 経由）と同じく、画面のコードは常に `/api` を呼べばよい。画面に「API: OK (ok)」と出れば、画面から api までつながっている。

- ポートを変えたいときは、`.env.example` を `.env` にコピーして値を書き換える。`.env` がなくても、`.env.example` の値で動く
- 画面は Vite + React（SPA）で、Bun で動かす（`bunfig.toml` で vite や tsc も Bun で実行する）。Node を別に入れる必要はない
- 整形と lint は Biome。保存時に整形されない場合は `bun run format` を実行する

### 困ったとき

- 手順どおりに動かない → [docs/setup.md の「よくあるトラブル」](docs/setup.md#よくあるトラブル)。直したら setup.md を直す PR を出す
- 仕様が分からない・仕様と矛盾しそう → 実装する前に Issue にコメントして相談する
- 契約（`packages/shared`）を変えたくなった → 自分で変えずに管理者に相談する
- 作業が止まっている → 1週間動きがないタスクはアサインを外すことがある。止まりそうなら早めにコメントで知らせる
