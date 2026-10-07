# packages/db（DB・状態遷移）

SQLite（bun:sqlite）+ Drizzle。状態変更の唯一の入口。

## 構成

| パス | 内容 |
| --- | --- |
| `src/schema.ts` | テーブル定義（Drizzle）。状態の列の候補は shared の列挙から取る |
| `drizzle/` | マイグレーション（`bun run db:generate` で生成）。生成済みのファイルは編集しない |
| `src/connection.ts` | `openDatabase`。WAL・ビジータイムアウト・外部キー・マイグレーション |
| `src/transaction.ts` | `write`：書き込みロックを先に取る（immediate）トランザクション |
| `src/orders.ts` | `createOrder`（採番）、`transitionOrder`、`pickupOrder`（確認コードを照合して受け渡し） |
| `src/items.ts`・`src/sheets.ts`・`src/reprint.ts` | 明細の遷移、印刷シート・印刷の確認、履歴からの再印刷 |
| `src/settings.ts` | 営業開始・受付状態・印刷の一時停止・設定の更新、失効 |
| `src/audit.ts` | 操作ログ。`listAuditLogsSince` で、前回以降の行を読む |
| `src/queries.ts` | 読み取りだけの関数（1 件の取得） |
| `src/listings.ts` | 画面向けの一覧と集計（注文の検索・印刷履歴・印刷済みバッジ・売上）。新しい順で、続きは `before` で取る |
| `src/archive.ts` | アーカイブ（A04）：投稿（同意の記録・審査待ちの上限）・遷移（承認・却下・非公開・取り下げ。非公開にしたら、コピーの支払い前の注文を失効）・通報・一覧 |
| `src/images.ts` | `listImagePathsInUse`：いまも使う画像のパス（失効していない注文・審査待ち／公開中の作品）。api の画像の掃除（A02）が、これに含まれない画像だけを消す |
| `src/rows.ts` | DB の行を、契約のエンティティにする（null は省略に、zod で検証） |
| `src/backup.ts` | バックアップ（`VACUUM INTO` で整合性のある DB のコピー＋画像の差分コピー）と復旧。CLI は `backup-cli.ts`・`restore-cli.ts`（`bun run backup`・`bun run restore`）。手順は `infra/backup.md` |
| `src/clock.ts` | 手で進められる時計（テスト・サンプルデータで時刻を固定する） |

使うときは `import { ... } from "@canbadge/db"` だけにする。

- 稼働中の DB ファイルを、そのままコピーしない（書き込み中に壊れる）。バックアップは `backupData`（`VACUUM INTO`）を使う

## ルール

- ステータスの変更は遷移関数（例: `transitionOrder(id, to, actor)`）だけで行う。遷移表は `packages/shared` のものを使い、表にない遷移は例外を投げる
- 更新は「現在の状態」を WHERE 条件に含めて行う。更新件数が 0 なら競合として扱う（二重遷移の防止）
- 状態変更とスタッフ操作ログの記録は同じトランザクションで行う
- 注文番号の採番はトランザクション内で行い、同時注文で重複させない
- `apps/api` と `apps/print-worker` の2プロセスが同じ DB を使う。接続時に WAL モードとビジータイムアウトを設定する
- スキーマ変更はマイグレーションファイルを生成して行う。既存のマイグレーションファイルは編集しない
- 遷移関数・採番・失効処理にはテストを書く。テストはメモリ上の SQLite で実行する
- エラーは `DbError`（`code` は shared の `ErrorCode` の一部）で投げ、`message` は画面に出せる日本語にする。api は `code` を HTTP ステータスに対応させる
- 書き込みは `write(db, ctx => ...)` の中で行い、複数の状態変更をまたぐ操作は、トランザクションの中で呼ぶ版（`applyOrderTransition` など）を使う。途中で例外が出れば、状態も操作ログもすべて取り消される
- 型の正本は shared の zod スキーマ。テーブルを変えたら `rows.test.ts` の型のテストで、契約とのずれを確かめる
- 空の DB に複数のプロセス（api と print-worker）が同時に起動しても、マイグレーションが衝突しないよう、`openDatabase` はプロセス間のロック（`<DB>.migrate-lock` フォルダ）を取ってから実行する。ロックを待つ設定（`busy_timeout`）は、WAL への切り替えより先に入れる（順序を逆にすると `database is locked` になる）
- `bun:sqlite` の `close()` は、使い終わっていないステートメントがあるとファイルの解放を遅らせる（Windows ではファイルを消せなくなる）。`Database.close()` を使う
