import { navigate, usePath } from "@canbadge/ui";
import { AssemblePage } from "./AssemblePage";
import { MonitorPage } from "./MonitorPage";
import { PrintPage } from "./PrintPage";
import { RegisterPage } from "./RegisterPage";
import { SettingsPage } from "./SettingsPage";

// 仮画面（T09）の入口。パスで画面を切り替える最小限のルーティング。見た目は T10 以降で作る。

const pages = [
  { path: "/register", label: "レジ", element: <RegisterPage /> },
  { path: "/print", label: "印刷確認", element: <PrintPage /> },
  { path: "/assemble", label: "組み立て・受け渡し", element: <AssemblePage /> },
  { path: "/monitor", label: "呼び出しモニター", element: <MonitorPage /> },
  { path: "/settings", label: "設定", element: <SettingsPage /> },
] as const;

export function App() {
  const path = usePath();
  const page = pages.find((p) => p.path === path);
  // 呼び出しモニターは、処理 PC の 2 画面目に全画面で出すので、メニューを出さない
  const showMenu = page?.path !== "/monitor";

  return (
    <>
      {showMenu && (
        <nav>
          {pages.map((p) => (
            <a
              key={p.path}
              href={p.path}
              style={{ marginRight: "1rem", fontWeight: p.path === path ? "bold" : "normal" }}
              onClick={(event) => {
                event.preventDefault();
                navigate(p.path);
              }}
            >
              {p.label}
            </a>
          ))}
        </nav>
      )}
      {page?.element ?? <RegisterPage />}
    </>
  );
}
