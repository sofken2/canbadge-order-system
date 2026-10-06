import { badgeSpec } from "@canbadge/badge-spec";
import { BadgeEditor, type BadgeEditorExport, OutputPreview } from "@canbadge/editor";
import { useEffect, useMemo, useState } from "react";

// 仮画面（W01）。エディタを触って確かめるための画面で、注文フロー（W02）ができたら置き換える。
// `?sample=<画像 ID>` を付けると、api の画像（サンプルデータの画像）を最初の写真にする。

type Result = { url: string; width: number; height: number; bytes: number; json: string };

/** 出力した PNG の、画素数と大きさを調べて、表示用の URL にする */
async function describe(output: BadgeEditorExport): Promise<Result> {
  const url = URL.createObjectURL(output.png);
  const image = new Image();
  image.src = url;
  await image.decode();
  return {
    url,
    width: image.naturalWidth,
    height: image.naturalHeight,
    bytes: output.png.size,
    json: JSON.stringify(output.editorData, null, 2),
  };
}

export function EditorPreviewPage() {
  const sample = useMemo(() => new URLSearchParams(window.location.search).get("sample"), []);
  const [result, setResult] = useState<Result | undefined>(undefined);

  // 古い出力の URL は、作り直すとき、閉じるときに解放する
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  return (
    <main className="cb-page">
      <h1>エディタ（確認用の仮画面）</h1>
      <BadgeEditor
        spec={badgeSpec}
        initialImage={sample ? `/api/images/${sample}` : undefined}
        onExport={(output) => void describe(output).then(setResult)}
      />

      {result && (
        <section className="cb-panel cb-gap-top" aria-label="出力の確認">
          <h2>出力</h2>
          <p className="cb-muted">
            PNG：{result.width} × {result.height} px、{Math.round(result.bytes / 1024)} KB
          </p>
          <p className="cb-muted">仕上がり（バッジの表に見える部分）</p>
          <OutputPreview src={result.url} spec={badgeSpec} />
          <p className="cb-muted cb-gap-top">出力した PNG の全体（塗り足しを含む）</p>
          <img src={result.url} alt="出力した PNG の全体" width={240} height={240} />
          <pre className="cb-muted">{result.json}</pre>
        </section>
      )}
    </main>
  );
}
