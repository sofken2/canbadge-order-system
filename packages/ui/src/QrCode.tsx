import { useMemo } from "react";
import { encode } from "uqr";
import { qrPathData } from "./qr";

/**
 * QR コード。カメラで読み取るので、白い地に黒、まわりに 4 マスの余白を付ける（QR の規格）。
 * 色は、地の色が明るく、マスの色が暗いことだけが大事。値は CSS（components.css）で、トークンから決める
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const { data, size } = encode(value, { ecc: "M", border: 0 });
    return { size, path: qrPathData(data) };
  }, [value]);
  const box = size + 8;
  return (
    <svg
      className="cb-qr"
      viewBox={`0 0 ${box} ${box}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect className="cb-qr__bg" width={box} height={box} />
      <path className="cb-qr__ink" d={path} />
    </svg>
  );
}
