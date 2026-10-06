/**
 * QR の、黒いマス目を、1 本のパス（SVG の d）にする。横に続くマスは、1 つの長方形にまとめる。
 * quiet は、まわりの余白のマス数。QR の規格では 4 マス以上が必要（カメラが、境目を見つけられるように）
 */
export function qrPathData(modules: readonly (readonly boolean[])[], quiet = 4): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end += 1;
      parts.push(`M${x + quiet} ${y + quiet}h${end - x}v1h${x - end}z`);
      x = end;
    }
  });
  return parts.join("");
}
