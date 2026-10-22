import type { ReactNode } from "react";

/**
 * 動かす道具のアイコン（24 × 24 の線画。色は文字の色に合わせる）。
 * 名前は、ボタンの aria-label と title で伝える（アイコンだけに頼らない）
 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const ZoomOutIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M8 11h6M16 16l4.5 4.5" />
  </Icon>
);

export const ZoomInIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M8 11h6M11 8v6M16 16l4.5 4.5" />
  </Icon>
);

export const RotateLeftIcon = () => (
  <Icon>
    <path d="M4.5 9.5A8 8 0 1 1 4 14" />
    <path d="M4 4.5v5h5" />
  </Icon>
);

export const RotateRightIcon = () => (
  <Icon>
    <path d="M19.5 9.5A8 8 0 1 0 20 14" />
    <path d="M20 4.5v5h-5" />
  </Icon>
);

export const CenterIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
  </Icon>
);

export const ResetIcon = () => (
  <Icon>
    <path d="M4 7h11a5 5 0 0 1 0 10H8" />
    <path d="M8 3 4 7l4 4" />
  </Icon>
);

export const NextIcon = () => (
  <Icon>
    <path d="M5 12h11M12 7l5 5-5 5M20 5v14" />
  </Icon>
);

export const FrontIcon = () => (
  <Icon>
    <rect x="3.5" y="9" width="11" height="11" rx="1.5" />
    <rect x="9.5" y="4" width="11" height="11" rx="1.5" fill="currentColor" fillOpacity="0.18" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />
  </Icon>
);
