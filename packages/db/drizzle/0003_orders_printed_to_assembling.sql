-- 印刷の確認と、組み立て開始の操作をなくした。印刷が終わると、注文は自動で「組み立て中」になる。
-- 状態 printed（印刷済み・組み立て待ち）は、なくなったので、残っている注文は、組み立て中にする。
UPDATE `orders` SET `status` = 'assembling' WHERE `status` = 'printed';
