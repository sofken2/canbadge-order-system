# apps/print-worker（面付け・印刷）

印刷待ちの明細を用紙単位にまとめ、PDF を生成して印刷する。本番は Windows + Canon PIXUS TS6730。

## 構成

| パス | 内容 |
| --- | --- |
| `src/index.ts` | 起動。DB を開き、ドライバーを選び、印刷キューの巡回を始める |
| `src/queue.ts` | 印刷キュー。`runQueueOnce`（1 回の巡回）と `startQueueLoop`。最小限の骨組みで、本番のキュー制御は P02 |
| `src/driver.ts` | 印刷ドライバー（`PrintDriver`）。開発用は PDF を `data/print-out/` に複製する。本番用（SumatraPDF）は P03 |
| `src/placeholder-pdf.ts` | 文字だけの仮の PDF。本物の面付けは P01 で、これを置き換える |

環境変数：`PRINT_DRIVER`（既定 dev）、`PRINT_POLL_MS`（巡回の間隔）、`PRINT_WAIT_OVERRIDE_SECONDS`（印刷待ちの最大時間を、設定の代わりに上書きする。開発用）。

## ルール

- 印刷処理はドライバーのインターフェースで抽象化する
  - 開発用ドライバー: PDF を出力フォルダに書き出すだけ（全OSで動く。CI・テストはこちらを使う）
  - 本番用ドライバー: SumatraPDF を `-print-to "<プリンター名>" -print-settings "noscale"` で呼び出す（Windows のみ）
- 使うドライバーとプリンター名は環境変数で切り替える。コードに直書きしない
- 寸法は `packages/badge-spec` の mm 値から配置する。画像の解像度に関係なく実寸になるようにする
- 各バッジの横に注文番号を印字する
- 印刷中のシートは同時に1枚まで。印刷係の確認が済むまで次を送らない
- 印刷を実行する前に、シートと明細の状態を DB に記録する（再起動時の二重印刷を防ぐ）
- 状態の変更は `packages/db` の遷移関数を使う。SQLite の status を直接更新しない
- 外部コマンドの呼び出しは引数を配列で渡す（シェル経由の文字列連結をしない）
