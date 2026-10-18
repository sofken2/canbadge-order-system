import type { BadgeSpec } from "@canbadge/badge-spec";
import { lazy, Suspense } from "react";
import { OutputPreview } from "./OutputPreview";

// three.js は大きいので、3D を見せるときまで読み込まない（編集画面と注文画面の最初の表示を重くしない）
const BadgePreview3D = lazy(() =>
  import("./BadgePreview3D").then((module) => ({ default: module.BadgePreview3D })),
);

/** 缶バッジの完成予想（3D）。読み込む間は、平面のプレビューを見せる */
export function LazyBadgePreview3D({ src, spec }: { src: string; spec: BadgeSpec }) {
  return (
    <Suspense fallback={<OutputPreview src={src} spec={spec} />}>
      <BadgePreview3D src={src} spec={spec} />
    </Suspense>
  );
}
