import { listPrinters } from "./driver-sumatra";

// Windows に登録されているプリンターの名前を、一覧にする。PRINTER_NAME に書く名前を、ここで確かめる。
//   bun run printers

try {
  const printers = await listPrinters();
  if (printers.length === 0) {
    console.log(
      "プリンターが登録されていません。Windows の「設定 → プリンターとスキャナー」で追加してください。",
    );
  } else {
    console.log("登録されているプリンター（PRINTER_NAME に、この名前を、そのまま書く）：");
    for (const name of printers) console.log(`  ${name}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
