import { printSheetStatusLabels } from "@canbadge/shared";
import { useAction, useResource } from "@canbadge/ui";
import { useState } from "react";
import { api } from "./api";

// 仮画面（T09）。印刷済みバッジの履歴・履歴からの再印刷・一時停止（S03）は、印刷確認画面で作る。

/**
 * 印刷確認。印刷中のシートに載っているバッジを、用紙の位置の順に出し、
 * 用紙を見て、再印刷にするバッジだけを選んで確認する（選ばなかったバッジは OK）
 */
export function PrintPage() {
  const current = useResource(() => api.call("getCurrentPrintSheet"), {
    subscribe: (reload) => api.subscribe("staffEvents", { onEvent: reload, onOpen: reload }),
  });
  const [reprint, setReprint] = useState<ReadonlySet<string>>(new Set());

  const check = useAction(async (sheetId: string) => {
    await api.call("checkPrintSheet", {
      params: { sheetId },
      body: { reprintOrderItemIds: [...reprint] },
    });
    setReprint(new Set());
    current.reload();
  });

  if (current.error) return <p role="alert">{current.error}</p>;
  const sheet = current.data?.sheet;

  return (
    <main>
      <h1>印刷確認（仮画面）</h1>
      {!sheet && <p>印刷中のシートはありません。</p>}
      {sheet && (
        <section>
          <p>
            シート：{printSheetStatusLabels[sheet.status]} ／{" "}
            <a
              href={api.url("getPrintSheetPdf", { params: { sheetId: sheet.id } })}
              target="_blank"
              rel="noreferrer"
            >
              PDF を開く
            </a>
          </p>
          <p>用紙の注文番号と見比べて、やり直したいバッジにチェックを入れてください。</p>
          <ol>
            {sheet.slots.map((slot) => (
              <li key={slot.orderItemId}>
                <img src={slot.thumbnailUrl} alt="バッジの画像" width={80} height={80} />{" "}
                <strong style={{ fontSize: "1.5rem" }}>{slot.orderNumberText}</strong>{" "}
                <label>
                  <input
                    type="checkbox"
                    checked={reprint.has(slot.orderItemId)}
                    onChange={(event) => {
                      const next = new Set(reprint);
                      if (event.target.checked) next.add(slot.orderItemId);
                      else next.delete(slot.orderItemId);
                      setReprint(next);
                    }}
                  />
                  再印刷
                </label>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => void check.run(sheet.id)} disabled={check.running}>
            確認する（{sheet.slots.length - reprint.size} 個 OK、{reprint.size} 個 再印刷）
          </button>
          {check.error && <p role="alert">{check.error}</p>}
        </section>
      )}
    </main>
  );
}
