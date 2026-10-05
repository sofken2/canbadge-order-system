import { type BadgeSpec, printDiameterMm } from "@canbadge/badge-spec";
import { useId } from "react";

/**
 * 出力の PNG を、バッジの表に見える部分（赤い縁の円）で切り取って見せる。
 * PNG は、缶の裏に折り込まれる塗り足しまで含む全体なので、そのまま見せると、
 * 画面で見ていた円の中身より小さく、縁の外側まで写って見える
 */
export function OutputPreview({ src, spec }: { src: string; spec: BadgeSpec }) {
  const clipId = useId();
  const full = printDiameterMm(spec);
  const radius = spec.diameterMm / 2;
  return (
    <svg
      className="cb-editor__preview"
      viewBox={`${-radius} ${-radius} ${radius * 2} ${radius * 2}`}
      role="img"
      aria-label="仕上がりのプレビュー（バッジの表に見える部分）"
    >
      <defs>
        <clipPath id={clipId}>
          <circle r={radius} />
        </clipPath>
      </defs>
      <image
        href={src}
        x={-full / 2}
        y={-full / 2}
        width={full}
        height={full}
        clipPath={`url(#${clipId})`}
      />
      <circle r={radius} className="cb-editor__preview-edge" />
    </svg>
  );
}
