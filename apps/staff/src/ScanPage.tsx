import { QrScanner, type UnavailableReason } from "@canbadge/scanner";
import { useMemo, useRef, useState } from "react";

// 仮画面（S01）。QR 読み取り部品を、カメラの前で試すための画面。レジ画面（S02）に組み込んだら、消す。
// `?decoder=js` で jsQR、`?decoder=native` で端末の標準の読み取り（使えなければ jsQR）を指定できる。

type Detection = { id: number; text: string; at: string };

export function ScanPage() {
  const decoder = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("decoder");
    return value === "js" || value === "native" ? value : "auto";
  }, []);
  const [detections, setDetections] = useState<Detection[]>([]);
  const nextId = useRef(0);
  const [unavailable, setUnavailable] = useState<UnavailableReason | undefined>(undefined);

  return (
    <main className="cb-page">
      <h1>QR の読み取り（確認用の仮画面）</h1>
      <QrScanner
        decoder={decoder}
        onDetect={(text) =>
          setDetections((current) => [
            { id: nextId.current++, text, at: new Date().toLocaleTimeString() },
            ...current,
          ])
        }
        onUnavailable={setUnavailable}
      />
      {unavailable && <p className="cb-muted">理由コード：{unavailable}</p>}
      <h2 className="cb-gap-top">読み取った値（{detections.length} 件）</h2>
      <ol className="cb-muted" aria-label="読み取った値">
        {detections.map((item) => (
          <li key={item.id}>
            {item.at}　{item.text}
          </li>
        ))}
      </ol>
    </main>
  );
}
