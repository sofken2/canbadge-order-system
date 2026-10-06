# packages/scanner（QR 読み取り）

専用アプリなしで、スタッフのスマホを QR リーダーにする React 部品（S01）。見た目は `design.md` とトークンに従う。各 app の入口で `@canbadge/scanner/styles.css` を読み込む。

```tsx
<QrScanner onDetect={(text) => ...} onUnavailable={(reason) => ...} />
```

読んだ文字列を、そのまま返す。意味の解釈（注文 ID か、注文番号か）は、呼ぶ側（S02・S04）の仕事。

## 構成

| パス | 内容 |
| --- | --- |
| `src/QrScanner.tsx` | 部品本体。カメラの起動・停止、読み取りの繰り返し、表示 |
| `src/decoder.ts` | 解読。端末標準の `BarcodeDetector` があれば使い、なければ jsQR（フレームを 640px に縮小して解く） |
| `src/scan-logic.ts` | 二重処理の防止（`shouldAccept`）、カメラが使えない理由と文言、縮小の計算。画面から切り離した純粋な関数 |
| `src/feedback.ts` | 読めたときの、振動と短い音 |
| `src/scanner.css` | 見た目（トークンの変数だけを使う） |

## ルール

- **同じ QR を向けたままでも、二重に処理しない。** 同じ値は、前に受け付けてから `ignoreSameMs`（既定 3 秒）の間、無視する。違う値は、すぐ受け付ける（次のお客さんの QR に、すぐ切り替わるように）
- **カメラが使えないときは、理由を分けて知らせる**（`UnavailableReason`：https でない・ブラウザが非対応・許可されない・カメラがない・使用中・その他）。`onUnavailable` で呼ぶ側に伝え、呼ぶ側が、番号の入力に切り替えられる。`hideWhenUnavailable` で、部品を出さないこともできる。カメラは https（または localhost）でしか使えない
- **画面を閉じたらカメラを止め、戻ったら起動し直す。** 止めないと、iPhone では、戻ったとき映らないことがある。アンマウントでも、必ず止める
- 背面カメラを使う（`facingMode: ideal`）。ライト（トーチ）に対応する端末では、切り替えのボタンが出る
- 解読は、画面の QR（白地に黒）を想定し、色を反転した QR は読まない（読もうとすると、倍かかる）
- 音は、ブラウザが操作前の再生を止めることがあるが、読み取りは成功として扱う（失敗にしない）。振動は、iPhone では動かない

## テスト

計算（`scan-logic.ts`）は `bun test`。カメラは、Chrome の偽のカメラ（QR を映した動画ファイル）で確かめられる。

```sh
chrome --use-fake-device-for-media-stream --use-fake-ui-for-media-stream \
  --use-file-for-fake-video-capture=<QR を映した .y4m> http://localhost:3001/scan
```

`/scan?decoder=js` で jsQR、`/scan?decoder=native` で端末の標準を指定できる（確認用の仮画面。S02 に組み込んだら消す）。
実機（iPhone・Android）で、スマホの画面に出した QR（反射・明るさ）を、早めに試すこと。
