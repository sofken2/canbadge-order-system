# canbadge-order-system

学祭のオリジナル缶バッジ注文・印刷・呼び出しシステム。

来場者がスマホでバッジをデザインして注文し、ブースで支払う。処理PCが自動で面付け・印刷し、スタッフが組み立てて番号で呼び出す。学祭まで約1ヶ月のため、**期日までに動くものを出すことが最優先**。

| 資料 | 内容 |
| --- | --- |
| [docs/setup.md](docs/setup.md) | 環境構築、日々の作業の流れ、Claude Code の使い方 |
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
| `packages/ui` | デザイントークンと共通 UI 部品（`design.md` に従う） | `shared` | T10 |
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

T01（モノレポ初期化）で確定する。確定するまでは予定。

```sh
bun install          # 依存関係のインストール
bun run dev          # 全 app を開発モードで起動
bun run typecheck    # 型チェック
bun run lint         # lint
bun run test         # テスト
bun run db:reset     # DB を作り直してシードを投入
```

PR を出す前に `typecheck`・`lint`・`test` を通す。各 app の URL とポートは T01 でここに追記する。

### 困ったとき

- 手順どおりに動かない → [docs/setup.md の「よくあるトラブル」](docs/setup.md#よくあるトラブル)。直したら setup.md を直す PR を出す
- 仕様が分からない・仕様と矛盾しそう → 実装する前に Issue にコメントして相談する
- 契約（`packages/shared`）を変えたくなった → 自分で変えずに管理者に相談する
- 作業が止まっている → 1週間動きがないタスクはアサインを外すことがある。止まりそうなら早めにコメントで知らせる
