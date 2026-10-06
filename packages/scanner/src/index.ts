// カメラでの QR 読み取り（S01）。見た目は @canbadge/scanner/styles.css を、各 app の入口で読み込む
export type { DecoderKind } from "./decoder";
export { QrScanner, type QrScannerProps } from "./QrScanner";
export { type UnavailableReason, unavailableMessage } from "./scan-logic";
