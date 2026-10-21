import { posix } from "node:path";
import {
  type ArchiveItem,
  type Database,
  getDesign,
  getSetting,
  listOrderItems,
  listSlotDetails,
  type PrintedItem,
  type ReportItem,
  type StaffArchiveItem,
} from "@canbadge/db";
import {
  type ArchiveEntryDetailView,
  type ArchiveEntryView,
  formatOrderNumber,
  type MyArchiveEntryView,
  type Order,
  type OrderStatus,
  type OrderView,
  type PrintedItemView,
  type PrintSheet,
  type PrintSheetView,
  type ReportView,
  type StaffArchiveEntryView,
  type StaffOrderView,
} from "@canbadge/shared";

// DB のエンティティから、画面に返す形（契約の *View）を組み立てる。
// 秘密（匿名トークン、スタッフ向けの確認コード）は、ここで項目を選ぶことで含めない。
// 契約のスキーマでの検証（register.ts）が、含めていないことをもう一度確かめる。

/** 画像のパス（images/<画像 ID>.<拡張子>）から、画像 ID を取り出す */
export function imageIdOf(imagePath: string): string {
  return posix.basename(imagePath, posix.extname(imagePath));
}

export const imageUrl = (imagePath: string): string => `/api/images/${imageIdOf(imagePath)}`;
export const thumbnailUrl = (imagePath: string): string => `${imageUrl(imagePath)}?size=thumb`;

function orderNumberText(db: Database, orderNumber: number): string {
  return formatOrderNumber(orderNumber, getSetting(db.orm).orderNumberDigits);
}

/** 来場者の注文状況ページ向け。確認コードを含み、匿名トークンは含めない */
export function buildOrderView(db: Database, order: Order): OrderView {
  const items = listOrderItems(db.orm, order.id).map((item) => {
    const design = getDesign(db.orm, item.designId);
    const path = design?.imagePath ?? "";
    return {
      id: item.id,
      quantity: item.quantity,
      kiraQuantity: item.kiraQuantity,
      magnetQuantity: item.magnetQuantity,
      status: item.status,
      imageUrl: imageUrl(path),
      thumbnailUrl: thumbnailUrl(path),
    };
  });
  return {
    id: order.id,
    businessDate: order.businessDate,
    orderNumber: order.orderNumber,
    orderNumberText: orderNumberText(db, order.orderNumber),
    confirmationCode: order.confirmationCode,
    status: order.status,
    totalAmount: order.totalAmount,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    readyAt: order.readyAt,
    pickedUpAt: order.pickedUpAt,
    items,
  };
}

/** スタッフ画面向け。確認コードは含めない（受け渡しの照合は pickup で、サーバーが行う） */
export function buildStaffOrderView(db: Database, order: Order): StaffOrderView {
  const items = listOrderItems(db.orm, order.id).map((item) => ({
    id: item.id,
    quantity: item.quantity,
    kiraQuantity: item.kiraQuantity,
    magnetQuantity: item.magnetQuantity,
    status: item.status,
    printCount: item.printCount,
    thumbnailUrl: thumbnailUrl(getDesign(db.orm, item.designId)?.imagePath ?? ""),
  }));
  return {
    id: order.id,
    businessDate: order.businessDate,
    orderNumber: order.orderNumber,
    orderNumberText: orderNumberText(db, order.orderNumber),
    status: order.status,
    totalAmount: order.totalAmount,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    readyAt: order.readyAt,
    pickedUpAt: order.pickedUpAt,
    refundedAt: order.refundedAt,
    items,
  };
}

/** 印刷シートと、載っているバッジ（位置・注文番号・サムネイル・確認結果） */
export function buildPrintSheetViews(db: Database, sheets: PrintSheet[]): PrintSheetView[] {
  const slots = listSlotDetails(
    db,
    sheets.map((sheet) => sheet.id),
  );
  return sheets.map((sheet) => ({
    id: sheet.id,
    status: sheet.status,
    printedAt: sheet.printedAt,
    checkedAt: sheet.checkedAt,
    slots: slots
      .filter((slot) => slot.sheetId === sheet.id)
      .map((slot) => ({
        position: slot.position,
        orderItemId: slot.orderItemId,
        orderId: slot.orderId,
        orderNumber: slot.orderNumber,
        orderNumberText: orderNumberText(db, slot.orderNumber),
        orderStatus: slot.orderStatus,
        thumbnailUrl: thumbnailUrl(slot.imagePath),
        result: slot.result,
      })),
  }));
}

/** 履歴から再印刷できる注文の状態（受け渡し済み・取り消し・失効・返金済みは、もう作り直さない） */
const reprintableOrderStatuses: readonly OrderStatus[] = ["paid", "printed", "assembling", "ready"];

export function buildPrintedItemView(db: Database, item: PrintedItem): PrintedItemView {
  return {
    orderItemId: item.orderItemId,
    orderId: item.orderId,
    orderNumber: item.orderNumber,
    orderNumberText: orderNumberText(db, item.orderNumber),
    orderStatus: item.orderStatus,
    status: item.itemStatus,
    printCount: item.printCount,
    lastPrintedAt: item.lastPrintedAt,
    thumbnailUrl: thumbnailUrl(item.imagePath),
    reprintable:
      item.itemStatus === "printed" && reprintableOrderStatuses.includes(item.orderStatus),
  };
}

// ---- アーカイブ。作者の匿名トークン（authorAnonToken）は、ここで項目を選んで、含めない ----

export function archiveEntryView({ entry, design }: ArchiveItem): ArchiveEntryView {
  return {
    id: entry.id,
    displayName: entry.displayName,
    thumbnailUrl: thumbnailUrl(design.imagePath),
    createdAt: entry.createdAt,
  };
}

export function myArchiveEntryView(item: ArchiveItem): MyArchiveEntryView {
  return { ...archiveEntryView(item), status: item.entry.status };
}

export function archiveEntryDetailView(item: ArchiveItem, isMine: boolean): ArchiveEntryDetailView {
  return {
    ...archiveEntryView(item),
    imageUrl: imageUrl(item.design.imagePath),
    editorData: item.design.editorData,
    status: item.entry.status,
    isMine,
  };
}

export function staffArchiveEntryView(
  { entry, design }: ArchiveItem,
  openReportCount: number,
): StaffArchiveEntryView {
  return {
    id: entry.id,
    displayName: entry.displayName,
    status: entry.status,
    thumbnailUrl: thumbnailUrl(design.imagePath),
    imageUrl: imageUrl(design.imagePath),
    createdAt: entry.createdAt,
    ...(entry.reviewedAt ? { reviewedAt: entry.reviewedAt } : {}),
    openReportCount,
  };
}

export const staffArchiveListItemView = (item: StaffArchiveItem): StaffArchiveEntryView =>
  staffArchiveEntryView(item, item.openReportCount);

export function reportView({ report, entry, design }: ReportItem): ReportView {
  return {
    ...report,
    entry: {
      displayName: entry.displayName,
      status: entry.status,
      thumbnailUrl: thumbnailUrl(design.imagePath),
      imageUrl: imageUrl(design.imagePath),
    },
  };
}
