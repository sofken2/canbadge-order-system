import { z } from "zod";
import { settingSchema } from "../entities/setting";
import { monitorSseEventSchema, orderSseEventSchema, staffSseEventSchema } from "../sse";
import {
  archiveEntryIdParamsSchema,
  imageIdParamsSchema,
  orderIdParamsSchema,
  pageQuerySchema,
  reportIdParamsSchema,
  sheetIdParamsSchema,
} from "./common";
import { monitorReadyResponseSchema } from "./monitor";
import {
  archiveEntryDetailViewSchema,
  archiveListQuerySchema,
  archiveListResponseSchema,
  createArchiveEntryRequestSchema,
  createArchiveEntryResponseSchema,
  createOrderRequestSchema,
  createOrderResponseSchema,
  discordCallbackQuerySchema,
  imageUploadResponseSchema,
  lookupOrderRequestSchema,
  lookupOrderResponseSchema,
  myArchiveEntryViewSchema,
  myArchiveListResponseSchema,
  orderFromArchiveRequestSchema,
  orderViewSchema,
  reportArchiveEntryRequestSchema,
  reportArchiveEntryResponseSchema,
  statusResponseSchema,
} from "./public";
import {
  currentPrintSheetResponseSchema,
  pickupRequestSchema,
  printedItemListResponseSchema,
  printedItemsQuerySchema,
  printQueueStateResponseSchema,
  printSheetListResponseSchema,
  printSheetViewSchema,
  reportListQuerySchema,
  reportListResponseSchema,
  reportViewSchema,
  reprintRequestSchema,
  reprintResponseSchema,
  resetEventRequestSchema,
  resetEventResponseSchema,
  resetSummarySchema,
  salesQuerySchema,
  salesResponseSchema,
  setAcceptanceRequestSchema,
  staffArchiveEntryViewSchema,
  staffArchiveListResponseSchema,
  staffArchiveQuerySchema,
  staffOrderListResponseSchema,
  staffOrderSearchQuerySchema,
  staffOrderViewSchema,
  updateSettingRequestSchema,
} from "./staff";

/**
 * 全エンドポイントの一覧。パス・認証の種類・入出力の形をここだけで持つ。
 * - api（T07 以降）は、この一覧のとおりに実装し、応答を response で検証するテストを付ける
 * - 画面は、パスの文字列を直接書かず、ここから取る
 * - A05（スタッフ認証）は access を見て、スタッフ用とモニター用を守る
 */
export type Endpoint = {
  readonly method: "GET" | "POST" | "PUT";
  /** /api から始まる。:name はパスの引数（params の項目名と一致する） */
  readonly path: string;
  /**
   * 誰が呼べるか。visitor は認証なし、staff は Access などで認証済みのスタッフ、
   * monitor は処理 PC の localhost（呼び出しモニター）だけ
   */
  readonly access: "visitor" | "staff" | "monitor";
  readonly summary: string;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  /** JSON の本体。画像のアップロード（multipart）は、ここでは表さない */
  readonly body?: z.ZodType;
  /** JSON の応答。画像・PDF・リダイレクト・SSE は null */
  readonly response: z.ZodType | null;
  /** SSE の購読。流れてくるイベントの形 */
  readonly stream?: z.ZodType;
};

const imageQuerySchema = z.object({ size: z.enum(["thumb"]).optional() });

export const endpoints = {
  // ---- 来場者向け ----
  getStatus: {
    method: "GET",
    path: "/api/status",
    access: "visitor",
    summary: "受付状態・価格・待ち件数",
    response: statusResponseSchema,
  },
  uploadImage: {
    method: "POST",
    path: "/api/images",
    access: "visitor",
    summary: "画像のアップロード（multipart）。容量と形式を検証する",
    response: imageUploadResponseSchema,
  },
  getImage: {
    method: "GET",
    path: "/api/images/:imageId",
    access: "visitor",
    summary: "画像の配信。size=thumb でサムネイル",
    params: imageIdParamsSchema,
    query: imageQuerySchema,
    response: null,
  },
  createOrder: {
    method: "POST",
    path: "/api/orders",
    access: "visitor",
    summary: "注文の作成。受付が open でないときは NOT_ACCEPTING",
    body: createOrderRequestSchema,
    response: createOrderResponseSchema,
  },
  getOrder: {
    method: "GET",
    path: "/api/orders/:orderId",
    access: "visitor",
    summary: "注文状況ページ用の注文",
    params: orderIdParamsSchema,
    response: orderViewSchema,
  },
  lookupOrder: {
    method: "POST",
    path: "/api/orders/lookup",
    access: "visitor",
    summary: "注文番号と確認コードから注文 ID を返す。試行回数を制限する",
    body: lookupOrderRequestSchema,
    response: lookupOrderResponseSchema,
  },
  cancelOrder: {
    method: "POST",
    path: "/api/orders/:orderId/cancel",
    access: "visitor",
    summary: "支払い前の注文の取り消し（来場者本人）",
    params: orderIdParamsSchema,
    response: orderViewSchema,
  },
  // ---- アーカイブ（来場者向け。投稿者の判定は匿名トークンの Cookie）----
  listArchive: {
    method: "GET",
    path: "/api/archive",
    access: "visitor",
    summary: "公開中の作品の一覧（新しい順）",
    query: archiveListQuerySchema,
    response: archiveListResponseSchema,
  },
  getArchiveEntry: {
    method: "GET",
    path: "/api/archive/:entryId",
    access: "visitor",
    summary: "作品の詳細。公開中の作品か、作者本人の作品",
    params: archiveEntryIdParamsSchema,
    response: archiveEntryDetailViewSchema,
  },
  listMyArchive: {
    method: "GET",
    path: "/api/my/archive",
    access: "visitor",
    summary: "自分が投稿した作品と、いまの状態（審査待ち・公開・却下・取り下げ）",
    response: myArchiveListResponseSchema,
  },
  createArchiveEntry: {
    method: "POST",
    path: "/api/archive",
    access: "visitor",
    summary: "作品を投稿する（審査待ち）。同意 2 項目が true でなければ、400",
    body: createArchiveEntryRequestSchema,
    response: createArchiveEntryResponseSchema,
  },
  withdrawArchiveEntry: {
    method: "POST",
    path: "/api/archive/:entryId/withdraw",
    access: "visitor",
    summary: "作者による取り下げ（公開中 → 非公開）。作者以外は NOT_FOUND",
    params: archiveEntryIdParamsSchema,
    response: myArchiveEntryViewSchema,
  },
  reportArchiveEntry: {
    method: "POST",
    path: "/api/archive/:entryId/report",
    access: "visitor",
    summary: "公開中の作品を通報する",
    params: archiveEntryIdParamsSchema,
    body: reportArchiveEntryRequestSchema,
    response: reportArchiveEntryResponseSchema,
  },
  orderFromArchive: {
    method: "POST",
    path: "/api/archive/:entryId/order",
    access: "visitor",
    summary: "公開中の作品をコピーして注文する。元作品が非公開になったら、支払い前の注文は止まる",
    params: archiveEntryIdParamsSchema,
    body: orderFromArchiveRequestSchema,
    response: createOrderResponseSchema,
  },
  discordAuthorize: {
    method: "GET",
    path: "/api/discord/authorize",
    access: "visitor",
    summary: "Discord の許可画面へリダイレクトする（W08）",
    response: null,
  },
  discordCallback: {
    method: "GET",
    path: "/api/discord/callback",
    access: "visitor",
    summary: "Discord からの戻り。アイコンを保存してエディタへリダイレクトする（W08）",
    query: discordCallbackQuerySchema,
    response: null,
  },
  orderEvents: {
    method: "GET",
    path: "/api/events/orders/:orderId",
    access: "visitor",
    summary: "自分の注文の変化を受け取る（SSE）",
    params: orderIdParamsSchema,
    response: null,
    stream: orderSseEventSchema,
  },

  // ---- スタッフ向け ----
  searchStaffOrders: {
    method: "GET",
    path: "/api/staff/orders",
    access: "staff",
    summary: "注文の検索。QR の中身（注文 ID）か当日の注文番号、状態で絞る",
    query: staffOrderSearchQuerySchema,
    response: staffOrderListResponseSchema,
  },
  payOrder: {
    method: "POST",
    path: "/api/staff/orders/:orderId/pay",
    access: "staff",
    summary: "支払い済みにする（現金のみ）。全明細を queued にする",
    params: orderIdParamsSchema,
    response: staffOrderViewSchema,
  },
  completeOrder: {
    method: "POST",
    path: "/api/staff/orders/:orderId/complete",
    access: "staff",
    summary: "完成。呼び出しモニターに表示される",
    params: orderIdParamsSchema,
    response: staffOrderViewSchema,
  },
  pickupOrder: {
    method: "POST",
    path: "/api/staff/orders/:orderId/pickup",
    access: "staff",
    summary: "受け渡し。確認コードを照合する",
    params: orderIdParamsSchema,
    body: pickupRequestSchema,
    response: staffOrderViewSchema,
  },
  refundOrder: {
    method: "POST",
    path: "/api/staff/orders/:orderId/refund",
    access: "staff",
    summary: "全額返金（支払い後のどの状態からでも）",
    params: orderIdParamsSchema,
    response: staffOrderViewSchema,
  },
  cancelStaffOrder: {
    method: "POST",
    path: "/api/staff/orders/:orderId/cancel",
    access: "staff",
    summary: "支払い前の注文の取り消し（スタッフ）",
    params: orderIdParamsSchema,
    response: staffOrderViewSchema,
  },
  getCurrentPrintSheet: {
    method: "GET",
    path: "/api/staff/print-sheets/current",
    access: "staff",
    summary: "印刷中のシート。なければ sheet が null",
    response: currentPrintSheetResponseSchema,
  },
  listPrintSheets: {
    method: "GET",
    path: "/api/staff/print-sheets",
    access: "staff",
    summary: "印刷ジョブの履歴（新しい順）",
    query: pageQuerySchema,
    response: printSheetListResponseSchema,
  },
  getPrintSheetPdf: {
    method: "GET",
    path: "/api/staff/print-sheets/:sheetId/pdf",
    access: "staff",
    summary: "印刷したシートの PDF（プレビュー）",
    params: sheetIdParamsSchema,
    response: null,
  },
  listPrintedItems: {
    method: "GET",
    path: "/api/staff/printed-items",
    access: "staff",
    summary: "印刷済みバッジの一覧（注文番号で検索）",
    query: printedItemsQuerySchema,
    response: printedItemListResponseSchema,
  },
  reprint: {
    method: "POST",
    path: "/api/staff/reprints",
    access: "staff",
    summary: "選んだバッジを再印刷に回す。バッジ一覧からもシートからも同じ API",
    body: reprintRequestSchema,
    response: reprintResponseSchema,
  },
  pausePrintQueue: {
    method: "POST",
    path: "/api/staff/print-queue/pause",
    access: "staff",
    summary: "印刷の一時停止",
    response: printQueueStateResponseSchema,
  },
  resumePrintQueue: {
    method: "POST",
    path: "/api/staff/print-queue/resume",
    access: "staff",
    summary: "印刷の再開",
    response: printQueueStateResponseSchema,
  },
  openBusinessDay: {
    method: "POST",
    path: "/api/staff/business-day/open",
    access: "staff",
    summary: "営業開始。営業日を今日にし、受付を open にし、前の営業日の支払い待ちを失効させる",
    response: settingSchema,
  },
  setAcceptance: {
    method: "POST",
    path: "/api/staff/acceptance",
    access: "staff",
    summary: "受付状態の切り替え（受付中・ビジー・受付終了）",
    body: setAcceptanceRequestSchema,
    response: settingSchema,
  },
  getSettings: {
    method: "GET",
    path: "/api/staff/settings",
    access: "staff",
    summary: "設定の取得",
    response: settingSchema,
  },
  updateSettings: {
    method: "PUT",
    path: "/api/staff/settings",
    access: "staff",
    summary: "設定（価格・上限など）の置き換え",
    body: updateSettingRequestSchema,
    response: settingSchema,
  },
  getSales: {
    method: "GET",
    path: "/api/staff/sales",
    access: "staff",
    summary: "売上の集計（時間帯別・返金を差し引いた合計）",
    query: salesQuerySchema,
    response: salesResponseSchema,
  },
  getResetSummary: {
    method: "GET",
    path: "/api/staff/reset",
    access: "staff",
    summary: "イベントデータのリセットで消えるものの件数と、いま実行できるか",
    response: resetSummarySchema,
  },
  resetEventData: {
    method: "POST",
    path: "/api/staff/reset",
    access: "staff",
    summary:
      "注文・売上・印刷の履歴・アーカイブを消し、営業開始の前に戻す（テストのあと・本番の前）。先にバックアップを取る。受付終了中だけ",
    body: resetEventRequestSchema,
    response: resetEventResponseSchema,
  },
  // ---- アーカイブの審査（スタッフ向け）----
  listStaffArchive: {
    method: "GET",
    path: "/api/staff/archive",
    access: "staff",
    summary: "アーカイブの審査の一覧（状態で絞る。未対応の通報の件数つき）",
    query: staffArchiveQuerySchema,
    response: staffArchiveListResponseSchema,
  },
  approveArchiveEntry: {
    method: "POST",
    path: "/api/staff/archive/:entryId/approve",
    access: "staff",
    summary: "承認（審査待ち → 公開）",
    params: archiveEntryIdParamsSchema,
    response: staffArchiveEntryViewSchema,
  },
  rejectArchiveEntry: {
    method: "POST",
    path: "/api/staff/archive/:entryId/reject",
    access: "staff",
    summary: "却下（審査待ち → 却下）",
    params: archiveEntryIdParamsSchema,
    response: staffArchiveEntryViewSchema,
  },
  hideArchiveEntry: {
    method: "POST",
    path: "/api/staff/archive/:entryId/hide",
    access: "staff",
    summary: "非公開にする（公開 → 非公開）。その作品から作った、支払い前の注文は止まる",
    params: archiveEntryIdParamsSchema,
    response: staffArchiveEntryViewSchema,
  },
  listArchiveReports: {
    method: "GET",
    path: "/api/staff/archive/reports",
    access: "staff",
    summary: "通報の一覧（作品の概要つき）",
    query: reportListQuerySchema,
    response: reportListResponseSchema,
  },
  resolveArchiveReport: {
    method: "POST",
    path: "/api/staff/archive/reports/:reportId/resolve",
    access: "staff",
    summary: "通報を、対応済みにする",
    params: reportIdParamsSchema,
    response: reportViewSchema,
  },
  staffEvents: {
    method: "GET",
    path: "/api/staff/events",
    access: "staff",
    summary: "注文・印刷・設定の変化を受け取る（SSE）",
    response: null,
    stream: staffSseEventSchema,
  },

  // ---- 呼び出しモニター ----
  getMonitorReady: {
    method: "GET",
    path: "/api/monitor/ready",
    access: "monitor",
    summary: "呼び出し中（ready）の注文番号の一覧",
    response: monitorReadyResponseSchema,
  },
  monitorEvents: {
    method: "GET",
    path: "/api/monitor/events",
    access: "monitor",
    summary: "呼び出し一覧の変化を受け取る（SSE）",
    response: null,
    stream: monitorSseEventSchema,
  },
} as const satisfies Record<string, Endpoint>;

export type EndpointName = keyof typeof endpoints;

/** パスの :name を、値に置き換える（値は URL エンコードする）。例: buildPath("/api/orders/:orderId", { orderId }) */
export function buildPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`パスの引数 ${name} がありません: ${path}`);
    return encodeURIComponent(value);
  });
}
