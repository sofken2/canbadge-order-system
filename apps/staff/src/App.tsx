import { useEffect, useState } from "react";

// 見た目は T10（デザインの土台）で決める。ここは api までつながることの確認だけ
export function App() {
  const [api, setApi] = useState("確認中…");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((body: { status: string }) => setApi(`OK (${body.status})`))
      .catch(() => setApi("届きません"));
  }, []);

  return (
    <main>
      <h1>スタッフ画面（準備中）</h1>
      <p>API: {api}</p>
    </main>
  );
}
