import type { Database } from "./connection";

/**
 * いまも使う画像のパス（Design.imagePath）を返す。画像の掃除（api）が、これに含まれない画像だけを消す。
 * 使う画像：
 * - 失効（expired）していない注文の、明細のデザイン
 * - アーカイブ作品から作ったデザイン（元作品と画像を共有しうるので、消さない）
 * - どの明細にも結ばれていないデザイン（結ばれ方が分からないものは、消さない）
 * 失効した注文だけが使う画像は、使わない（spec.md 13.3）
 */
export function listImagePathsInUse(db: Database): Set<string> {
  const rows = db.sqlite
    .query(
      `SELECT DISTINCT d.image_path AS path
         FROM designs d
        WHERE d.source_archive_entry_id IS NOT NULL
           OR NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.design_id = d.id)
           OR EXISTS (
                SELECT 1
                  FROM order_items oi
                  JOIN orders o ON o.id = oi.order_id
                 WHERE oi.design_id = d.id AND o.status <> 'expired'
              )`,
    )
    .all() as { path: string }[];
  return new Set(rows.map((row) => row.path));
}
