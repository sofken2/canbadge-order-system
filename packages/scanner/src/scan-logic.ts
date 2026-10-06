// QR 読み取りの、画面から切り離した計算（テストできるように）。

/** カメラが使えない理由 */
export type UnavailableReason =
  /** https でも localhost でもない（ブラウザが、カメラを使わせない） */
  | "insecure"
  /** このブラウザは、カメラを使う仕組みを持たない */
  | "unsupported"
  /** 使う許可をもらえなかった */
  | "denied"
  /** カメラがない */
  | "no-camera"
  /** 別のアプリが、カメラを使っている */
  | "in-use"
  | "error";

/** 画面に出す、理由と、してほしいこと */
export function unavailableMessage(reason: UnavailableReason): string {
  switch (reason) {
    case "insecure":
      return "カメラは、https のアドレスでしか使えません。アドレスを確かめてください。";
    case "unsupported":
      return "このブラウザでは、カメラを使えません。別のブラウザ（Safari・Chrome）で開いてください。";
    case "denied":
      return "カメラの使用が許可されていません。ブラウザの設定で、このサイトのカメラを許可してください。";
    case "no-camera":
      return "カメラが見つかりません。カメラのある端末で開くか、番号を入れてください。";
    case "in-use":
      return "ほかのアプリが、カメラを使っています。そのアプリを閉じてから、もう一度試してください。";
    case "error":
      return "カメラを起動できませんでした。ページを開き直すか、番号を入れてください。";
  }
}

/** getUserMedia の失敗（DOMException の名前）を、理由にする */
export function classifyCameraError(error: unknown): UnavailableReason {
  const name =
    typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no-camera";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in-use";
    default:
      return "error";
  }
}

export type LastDetection = { value: string; at: number };

/**
 * 読み取った値を、受け付けるか。同じ値は、前に受け付けてから ignoreMs の間は、無視する
 * （QR を向けたままだと、毎フレーム読めて、同じ注文を何度も処理してしまうため）。
 * 違う値は、すぐ受け付ける（次のお客さんの QR に、すぐ切り替えられるように）
 */
export function shouldAccept(
  last: LastDetection | undefined,
  value: string,
  now: number,
  ignoreMs: number,
): boolean {
  if (!last || last.value !== value) return true;
  return now - last.at >= ignoreMs;
}

/** 縦横比を保って、長いほうの辺が maxSide に収まる大きさにする（解読の前に縮小して、計算を軽くする） */
export function fitSize(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest === 0) return { width, height };
  const ratio = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
