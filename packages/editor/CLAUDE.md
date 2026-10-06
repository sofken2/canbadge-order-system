# packages/editor（バッジのキャンバスエディタ）

来場者がスマホで、バッジのデザインを作る部品（W01）。Konva（react-konva）で描く。
見た目は `design.md` と `@canbadge/ui` のトークンに従う。各 app の入口で `@canbadge/editor/styles.css` を読み込む。

## 構成

| パス | 内容 |
| --- | --- |
| `src/BadgeEditor.tsx` | 部品本体。キャンバス・ガイド・指／マウスの操作・ボタン・出力。`<BadgeEditor spec initialData? initialImage? onExport />` |
| `src/LayerNodes.tsx` | キャンバスに、写真・文字・スタンプの層を描く |
| `src/Panels.tsx` | 道具のパネル（文字・スタンプ・背景・フィルター）と、色の選択。状態は持たず、表示と入力だけ |
| `src/layers.ts` | 層の操作（追加・更新・削除・手前に出す）、タップした層を探す `hitTest`、位置と大きさの範囲。画面から切り離した純粋な関数 |
| `src/model.ts` | 編集データ（`editorData`）の形（zod）と、読み戻し（`parseEditorState`）。層は写真・文字・スタンプ。版は `EDITOR_DATA_VERSION` |
| `src/fonts.ts` | 文字の書体（4 種）と、Google Fonts の読み込み。キャンバスは、読み込んだあとでないと正しく描けない |
| `src/stickers.ts` | スタンプの形（10 種、自作の SVG パス）。色を選べる |
| `src/palette.ts` | 文字・スタンプ・背景の色の候補（来場者のデザインの色。画面のトークンとは別） |
| `src/filter-params.ts` / `src/filters.ts` | 写真のフィルターの数値（純粋）／Konva の組み込みフィルターを、縮小済みの写真に 1 回だけかける |
| `src/text-measure.ts` | 文字の幅を測る（当たり判定と、中心の合わせ方に使う） |
| `src/gesture.ts` | 移動・ピンチ（拡大と回転）・ボタンの計算。画面から切り離した純粋な関数 |
| `src/image-size.ts` | 写真の縮小サイズ・キャンバスを覆う幅・実効解像度の計算 |
| `src/load-image.ts` | 写真を読み込み、EXIF の向きを直し、上限（2048px）まで縮小する |
| `src/css-color.ts` | トークン（CSS 変数）の色を、キャンバスに描ける色にする |
| `src/editor.css` | エディタの見た目（トークンの変数だけを使う） |

## ルール

- **寸法は `@canbadge/badge-spec` から取る。** キャンバスの一辺は `printDiameterMm`（直径 + 塗り足し × 2）。mm と px の換算は `mmToPx` を通す
- **座標は mm で持つ**（キャンバスの中心が原点、右・下が正）。編集データも mm なので、画面の大きさや dpi を変えても、デザインがずれない。Konva のステージは「1 単位 = 1mm」で描き、画面に出す大きさは `scale` で合わせる
- **出力の PNG は、正方形で、印刷する円を含む全面（塗り足しまで）。** 解像度は `spec.dpi`。ガイド線は出力に入れない（出力の間だけガイドの層を隠す）。画面で見ている赤い縁の円（バッジの表）より、出力は大きく写る。来場者に見せるプレビューは `OutputPreview`（赤い縁の円で切り取る）を使う。写真が印刷範囲を覆っていないとき（`coversCircle`）は、端が白くなるので、画面で警告する
- **写真は、読み込み時に縮小する**（長いほうの辺を 2048px まで）。スマホの写真をそのまま扱うと、メモリが足りなくなる。縮小済みの写真に、フィルターなどをかける
- **editorData の形を変えるときは、`EDITOR_DATA_VERSION` を上げる。** 読み戻せない版は、空から始める（`parseEditorState` が `undefined` を返す）。契約（shared）の `editorData` は、版を持つ任意のオブジェクトなので、契約の変更は要らない
- **層は、写真（いちばん下・1 つだけ）→ 文字・スタンプ（上に重なる）の順。** どの層も、中心の位置・大きさ・回転を持ち、`placementOf`／`withPlacement` で、同じ計算（`gesture.ts`）にそろえて動かす。触り始めに、触った場所の層を選び（`hitTest`）、その触っている間は、同じ層を動かす
- **写真のフィルターは、ノードにかけない。** 縮小済みの写真に 1 回だけかけて、フィルターを変えたときだけ作り直す（ピンチのたびに計算し直すと、スマホで重い）。Konva のフィルターは、`this` に「値を返す関数」を持つノードを受け取る作りなので、`filters.ts` の `run` で、その形の入れ物を渡す
- **書体は、読み込みが済んでから描く。** 文字を足す・変えるたびに `loadFontFor`（字形の読み込み）を呼び、終わったら描き直す。読み込めなくても、代わりの書体で描く（失敗にはしない）
- 写真の画素は `editorData` に入れない（大きいため）。ブラウザ内の途中保存と、W07（作品のコピー）は、写真を別に持つ
- 指の操作は、ポインターイベントで受ける（フレームの `touch-action: none`）。計算は `gesture.ts` に置き、ブラウザなしでテストする
- 色は、トークン（`--color-*`）から取る。キャンバスは CSS 変数を読めないので、`resolveColor` を通す

## テスト

計算（`gesture.ts`・`image-size.ts`・`model.ts`）は、`bun test` で確かめる。描画と操作は、ブラウザで確かめる。

```sh
bun run db:reset   # サンプルの画像を作る（初回）
bun run dev        # http://localhost:3000/editor を開く
```

`/editor?sample=01J00000000000000000000001` で、サンプルの画像を最初の写真にできる。スマホで確かめるときは、同じ Wi-Fi から PC の IP（`http://<PC の IP>:3000/editor`）を開く。
