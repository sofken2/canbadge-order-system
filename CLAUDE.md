# CLAUDE.md

学祭で来場者がWebからオリジナル缶バッジを注文し、ブースで支払い、印刷・手作業での組み立て後に呼び出す仕組み。
学祭まで約1ヶ月。**動くものを期日までに出すことが最優先**。

## 仕様の所在

- 仕様書: `docs/spec.md`（構成・状態遷移・データモデル）
- タスク一覧と解説: `docs/tasks.md`
- 作業は必ず GitHub Issue 単位。Issue に書かれた範囲だけを実装する

仕様書と矛盾する実装が必要だと判断した場合は、実装せずに理由を説明して確認を求めること。

## 構成

Bun + Turborepo のモノレポ。本番は Windows の処理PC 1台で全プロセスを動かし、Cloudflare Tunnel → Caddy 経由で公開する。

| パス | 役割 |
| --- | --- |
| `apps/web` | 来場者向け（エディタ・注文・注文状況） |
| `apps/staff` | スタッフ向け（レジ・印刷確認・組み立て・受け渡し・設定・呼び出しモニター） |
| `apps/api` | REST API と SSE（Hono on Bun） |
| `apps/print-worker` | 面付け・PDF生成・印刷 |
| `packages/shared` | 契約（zod スキーマ・ステータス・遷移表・API型・SSEイベント型） |
| `packages/db` | SQLite + Drizzle、状態遷移関数 |
| `packages/fixtures` | 共通サンプルデータとシード |
| `packages/editor` | キャンバスエディタ |
| `packages/scanner` | カメラでのQR読み取り |
| `packages/badge-spec` | 寸法・解像度・面付けの設定値 |
| `packages/ui` | デザイントークンと共通UI部品（`design.md` に従う） |
| `packages/api-client` | 型付きのAPIクライアント（契約の `endpoints` から作る）。画面はこれで `/api` を呼ぶ |
| `packages/e2e` | 通し確認。api と print-worker を実際に起動して、注文から受け渡しまでを通す |
| `infra/` | Caddy・cloudflared 設定、Windows 起動スクリプト、手順書 |

## コマンド

```sh
bun install          # 依存関係のインストール
bun run dev          # 全appを開発モードで起動
bun run typecheck    # 型チェック（全パッケージ）
bun run lint         # lint（Biome）
bun run test         # テスト（bun test）
bun run build        # ビルド
bun run format       # 整形（Biome）
bun run db:reset     # DBを作り直してシードを投入（data/ に DB・サンプル画像・PDF ができる）
```

特定のパッケージだけ実行する場合は `bunx turbo run <task> --filter=@canbadge/<名前>`。

- ポート：web 3000 / staff 3001 / api 3002。`.env.example` が既定値で、`.env` があれば上書きされる。**処理PC の設定（実プリンター・本番の URL・バックアップ先）は `.env.production`** に置く。処理PC の起動（`infra/windows/start-all.ps1`）とビルドのときだけ `.env` を上書きし、`bun run dev` には効かない（PC を替える手順は `infra/moving.md`）
- web・staff は Vite + React（SPA）。`/api` は api へ転送されるので、画面のコードは常に `/api` を呼ぶ。呼ぶときは `@canbadge/api-client`（エンドポイントの名前で呼び、応答を契約で検証する）を使い、パスの文字列や `fetch` を画面に直接書かない
- 通し確認（`packages/e2e`）は `bun run test` に含まれる。api・print-worker・契約・DB のどれかを変えて、注文から受け渡しまでの流れが壊れたら、ここで失敗する
- vite や tsc も Bun で動かす（`bunfig.toml`）。Node 前提のコマンドを書かない
- パッケージ名は `@canbadge/<名前>`。lint と整形は Biome（`biome.json`）

## 必ず守るルール

- **契約は `packages/shared` にだけ定義する。** app 側で型やステータスを独自に定義しない。契約の変更が必要なら、変更せずに提案として説明する（契約オーナーがレビューする）
- **状態の変更は必ず `packages/db` の遷移関数を通す。** app から status 列を直接 UPDATE しない
- **ダミーデータは `packages/fixtures` のものを使う。** app 内に独自のモックデータを書かない。画面は最初から `apps/api` を呼ぶ
- **寸法は `packages/badge-spec` の値を使う。** mm で持ち、px への換算は用意された関数を通す
- **本番は Windows。** パス区切り文字をハードコードせず `node:path` を使う。シェル固有のコマンドに依存しない
- **秘密情報をコミットしない。** トークン・パスワードは `.env`（コミット対象外）に置き、`.env.example` にキー名だけを書く
- **金額は円の整数（number）で扱う。** 小数を使わない
- **画面（UI）を作る・直すときは Hallmark スキル（`.claude/skills/hallmark`）を使う。** 配色・書体などはプロジェクト直下の `design.md` と `packages/ui` のトークンに従い、画面側で独自に決めない。`design.md` がない場合は、テーマを勝手に選ばず確認を求める（`docs/spec.md` 6.4）

## 優先度を下げた機能

次は Issue で明示的に指示されない限り実装しない。

- アーカイブ（投稿・閲覧・審査・作品からの注文）
- 回線断時の会場LAN運用（LAN経由のPIN認証など）

## 作業の進め方

1. 着手前に、対象の Issue と関連する仕様書の章を読む
2. 変更範囲が Issue を超えそうなら、先に計画を説明して確認を求める
3. 実装後は `bun run typecheck`・`bun run lint`・`bun run test` を通す
4. 動作確認の方法（どの画面で何をすれば確認できるか）を最後に説明する

## コーディング規約

- TypeScript strict。`any` は使わない。外部からの入力は zod で検証する
- 1ファイル1責務。共通化は2回目に必要になってから
- テストは状態遷移・採番・面付けなどのロジックを優先する。UI のテストは必須ではない
- コメントは「なぜそうしたか」を書く。「何をしているか」はコードで表す

## Git

- ブランチ名: `<種別>/<IssueID>-<短い説明>`（例: `feat/W01-editor`、`fix/A01-order-number`）
- コミットメッセージ: `<種別>(<範囲>): <内容>`（例: `feat(api): 注文番号の採番を追加`）。種別は feat / fix / refactor / test / docs / chore
- `main` へ直接 push しない。PR 本文に `Closes #<Issue番号>` を書く
- コミットや push はユーザーに指示されたときだけ行う
