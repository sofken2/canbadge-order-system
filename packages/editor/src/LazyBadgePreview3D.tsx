import type { BadgeSpec } from "@canbadge/badge-spec";
import { lazy, Suspense } from "react";
import type { BadgeBack } from "./badgeModel";
import type { BadgeFilm } from "./kiraFilm";
import { OutputPreview } from "./OutputPreview";

// three.js は大きいので、3D を見せるときまで読み込まない（編集画面と注文画面の最初の表示を重くしない）
const BadgePreview3D = lazy(() =>
  import("./BadgePreview3D").then((module) => ({ default: module.BadgePreview3D })),
);

/** 缶バッジの完成予想（3D）。読み込む間は、平面のプレビューを見せる（flatWhileLoading が false なら、何も出さない） */
export function LazyBadgePreview3D({
  src,
  spec,
  label,
  onTap,
  back,
  film,
  flatWhileLoading = true,
}: {
  src: string;
  spec: BadgeSpec;
  label?: string;
  onTap?: () => void;
  /** 裏の作り。安全ピン（省略時）か、マグネット */
  back?: BadgeBack;
  /** キラフィルム（省略時は、なし） */
  film?: BadgeFilm;
  /** false にすると、3D が出るまで場所だけ取って空けておく（はじめの画面で、平面から 3D に切り替わるちらつきを見せない） */
  flatWhileLoading?: boolean;
}) {
  return (
    <Suspense fallback={flatWhileLoading ? <OutputPreview src={src} spec={spec} /> : null}>
      <BadgePreview3D src={src} spec={spec} label={label} onTap={onTap} back={back} film={film} />
    </Suspense>
  );
}
