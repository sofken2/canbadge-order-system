import { isCompleteCode } from "@canbadge/ui";

// 注文照会（W04）の、画面から切り離した判定と文（テストできるように）。

/** 注文番号の入力（全角も可）を、整数にする。数字だけ・1〜6 桁。それ以外は undefined */
export function parseOrderNumber(raw: string): number | undefined {
  const text = raw.normalize("NFKC").trim();
  if (!/^\d{1,6}$/.test(text)) return undefined;
  const value = Number(text);
  return value > 0 ? value : undefined;
}

export type LookupInput =
  | { ok: true; orderNumber: number; confirmationCode: string }
  | { ok: false; errors: { orderNumber?: string; confirmationCode?: string } };

/** 入力を、送れる形にする。足りない・形が違う欄は、その欄に、してほしいことを添えて返す */
export function parseLookupInput(numberText: string, code: string): LookupInput {
  const orderNumber = parseOrderNumber(numberText);
  const errors: { orderNumber?: string; confirmationCode?: string } = {};
  if (orderNumber === undefined) {
    errors.orderNumber =
      numberText.trim() === ""
        ? "注文番号を入れてください"
        : "注文番号は、数字（1〜6 桁）で入れてください";
  }
  if (!isCompleteCode(code)) {
    errors.confirmationCode =
      code === ""
        ? "確認コードを入れてください"
        : "確認コードは、4 文字です。もう一度、確かめてください";
  }
  if (orderNumber === undefined || errors.confirmationCode) return { ok: false, errors };
  return { ok: true, orderNumber, confirmationCode: code };
}

/**
 * 照会に失敗したとき、画面に出す文。
 * - 見つからない（404）：番号と確認コードの、どちらが違うかは、教えない（総当たりの手がかりにさせない）
 * - 回数の制限（429）：api の文（待つ時間つき）を、そのまま出す
 * - つながらない：回線を確かめるよう伝える
 */
export function lookupErrorMessage(error: { code: string; message: string }): string {
  switch (error.code) {
    case "NOT_FOUND":
      return "注文が見つかりませんでした。注文番号と確認コードを、もう一度、確かめてください。注文番号は、今日の注文のものだけです。";
    case "RATE_LIMITED":
      return error.message;
    case "NETWORK":
      return "つながりませんでした。電波の良い所で、もう一度、お試しください。";
    case "VALIDATION_FAILED":
      return "入力が正しくありません。注文番号と確認コードを、確かめてください。";
    default:
      return "うまく開けませんでした。少し待ってから、もう一度お試しください。それでも開けないときは、ブースのスタッフにお声がけください。";
  }
}
