import type { Database } from "./connection";

/**
 * いまも使う画像のパス（Design.imagePath）を返す。画像の掃除（api）が、これに含まれない画像だけを消す。
 * 使う画像：
 * - 失効（expired）していない注文の、明細のデザイン
 * - 審査待ち・公開中のアーカイブ作品のデザイン（却下・非公開になった作品の画像は、使わない）
 * - 注文にも、アーカイブにも、結ばれていないデザイン（結ばれ方が分からないものは、消さない）
 * 失効した注文だけが使う画像・却下や非公開になった作品の画像は、使わない（spec.md 13.3）。
 * 作品をコピーした注文は、元作品と同じ画像を指す。元作品が非公開になっても、コピーの注文が生きている間は、消えない
 */
export function listImagePathsInUse(db: Database): Set<string> {
  const rows = db.sqlite
    .query(
      `SELECT DISTINCT d.image_path AS path
         FROM designs d
        WHERE EXISTS (
                SELECT 1
                  FROM order_items oi
                  JOIN orders o ON o.id = oi.order_id
                 WHERE oi.design_id = d.id AND o.status <> 'expired'
              )
           OR EXISTS (
                SELECT 1
                  FROM archive_entries a
                 WHERE a.design_id = d.id AND a.status IN ('pending_review', 'public')
              )
           OR (
                NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.design_id = d.id)
                AND NOT EXISTS (SELECT 1 FROM archive_entries a WHERE a.design_id = d.id)
              )`,
    )
    .all() as { path: string }[];
  return new Set(rows.map((row) => row.path));
}
