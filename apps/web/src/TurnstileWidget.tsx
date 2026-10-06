import { Notice } from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile（ボット対策）。確認が通ると、トークンを onToken で返す。
// トークンは 1 回しか使えず、期限もある。使い終わったら（注文を試したら）resetKey を変えて、作り直す。

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptPromise: Promise<void> | undefined;

/** Turnstile の部品を、1 回だけ読み込む。失敗したら、次に呼んだときに、もう一度試す */
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error("Turnstile を読み込めませんでした"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export function TurnstileWidget({
  siteKey,
  onToken,
  resetKey,
}: {
  siteKey: string;
  /** 確認が通ったらトークン、期限が切れた・失敗したら undefined */
  onToken: (token: string | undefined) => void;
  resetKey: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // 呼び出し側の関数が変わっても、ウィジェットを作り直さない
  const tokenHandler = useRef(onToken);
  tokenHandler.current = onToken;

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey は、ウィジェットを作り直す合図
  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    setFailed(false);
    tokenHandler.current(undefined);
    loadScript()
      .then(() => {
        const element = container.current;
        if (cancelled || !element || !window.turnstile) return;
        widgetId = window.turnstile.render(element, {
          sitekey: siteKey,
          callback: (token) => tokenHandler.current(token),
          "expired-callback": () => tokenHandler.current(undefined),
          "error-callback": () => tokenHandler.current(undefined),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, resetKey]);

  return (
    <div>
      <div ref={container} data-turnstile />
      {failed && (
        <Notice tone="error">
          確認の部品を読み込めませんでした。回線を確かめて、ページを開き直してください。
        </Notice>
      )}
    </div>
  );
}
