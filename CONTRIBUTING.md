# コントリビューションの流れ

学祭までの期間が短いので、ルールは最小限にしています。環境構築と日々のコマンドは [docs/setup.md](docs/setup.md)、全体の説明は [README.md](README.md) を見てください。

## 進め方

1. [Projects ボード](https://github.com/orgs/sofken2/projects/3)の「未着手」から Issue を選び、「やります」とコメントして自分を Assignees に追加する。管理者が承認したら「作業中」に移す
2. ブランチを切る：`<種別>/<IssueID>-<短い説明>`（例：`feat/W03-order-status`）
3. 早めに Draft PR を出す：`gh pr create --draft --fill`。PR 本文に `Closes #<Issue番号>` を書く
4. 完成したら Draft を解除し、ボードを「レビュー待ち」に移す
5. レビューを受けて、Squash merge でマージする（マージ後のブランチは自動で削除される）

同時に持てるタスクは 1〜2 件まで。1 週間動きがないときは、確認のうえでアサインを外すことがある。

## 守ること

- **Issue に書かれた範囲だけを実装する。** 範囲を超えそうなときは、先に Issue にコメントして相談する
- **コミットメッセージ：** `<種別>(<範囲>): <内容>`（例：`feat(api): 注文番号の採番を追加`）。種別は feat / fix / refactor / test / docs / chore
- **`main` に直接 push しない。** 必ず PR を経由する
- **PR を出す前に `bun run typecheck`・`bun run lint`・`bun run test` を通す。** CI（GitHub Actions）でも同じ検査が走る
- **CI が赤のままマージしない。** 無料プランの private リポジトリでは、GitHub の設定でマージを止められない。参加者全員が自分で守る
- **契約（`packages/shared`）の変更は、契約オーナーのレビューが必須。** 影響する app を PR に書く。迷ったら変更せずに相談する
- **生成された AI のコードも、自分で読んで理解してから出す。** レビューで説明できないコードはマージしない
- **秘密情報（トークン・パスワード）をコミットしない。** `.env` に置き、`.env.example` にキー名だけを書く

詳しいルールは [CLAUDE.md](CLAUDE.md) にあります。人が開発する場合も同じルールで進めます。

## Issue

- タスクは `docs/tasks.md` から作る。タイトルの先頭に ID を付ける（例：`[W03] 注文状況ページ`）
- 不具合の報告は、Issue の「不具合」テンプレートを使う
