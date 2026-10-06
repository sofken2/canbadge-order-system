import { Button, Notice } from "@canbadge/ui";
import { useEffect, useRef, useState } from "react";
import { createDecoder, type DecoderKind } from "./decoder";
import { type Feedback, notifyDetected } from "./feedback";
import {
  classifyCameraError,
  type LastDetection,
  shouldAccept,
  type UnavailableReason,
  unavailableMessage,
} from "./scan-logic";

export type QrScannerProps = {
  /** QR を読めたとき。読んだ文字列を、そのまま返す（意味の解釈は、呼ぶ側） */
  onDetect: (text: string) => void;
  /** カメラが使えないとき、その理由。呼ぶ側が、ほかの入力（番号の入力など）に切り替えられるように */
  onUnavailable?: (reason: UnavailableReason) => void;
  /** カメラが使えないとき、この部品を何も出さない（呼ぶ側が、代わりの入力を出すため）。既定は、理由を出す */
  hideWhenUnavailable?: boolean;
  /** true の間は、カメラは映したまま、読み取りだけを止める（確認の画面を出している間など） */
  paused?: boolean;
  /** 同じ値を、前に読んでから、この間は無視する（ms）。同じ QR を向けたままでも、二重に処理しない */
  ignoreSameMs?: number;
  feedback?: Feedback;
  /** 解読の方法。既定は jsQR（仕様書 6.3）。native は、端末の標準（実験用） */
  decoder?: DecoderKind;
};

/** カメラの映像を読む間隔（ms）。短いほど反応が速いが、端末が熱くなる */
const SCAN_INTERVAL_MS = 110;
/** 「読み取りました」の表示を残す時間（ms） */
const FLASH_MS = 500;

type State =
  | { kind: "starting" }
  | { kind: "ready"; decoder: "native" | "js" }
  | { kind: "unavailable"; reason: UnavailableReason };

/** ライト（トーチ）に対応しているか。TypeScript の DOM の型には、torch がまだないので、ここで確かめる */
function supportsTorch(track: MediaStreamTrack | undefined): boolean {
  const capabilities = (
    track as unknown as { getCapabilities?: () => { torch?: boolean } } | undefined
  )?.getCapabilities?.();
  return Boolean(capabilities?.torch);
}

export function QrScanner({
  onDetect,
  onUnavailable,
  hideWhenUnavailable = false,
  paused = false,
  ignoreSameMs = 3000,
  feedback,
  decoder: decoderKind = "js",
}: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | undefined>(undefined);
  const [state, setState] = useState<State>({ kind: "starting" });
  const [flash, setFlash] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  /** 画面が見えているか。見えていない間は、カメラを止める（iPhone は、止めないと、戻ったとき映らないことがある） */
  const [visible, setVisible] = useState(typeof document === "undefined" ? true : !document.hidden);
  /** 「もう一度試す」で増やす。カメラの起動を、やり直す */
  const [attempt, setAttempt] = useState(0);

  // 最新の値を、起動し直さずに使うために、ref に持つ
  const callbacks = useRef({ onDetect, onUnavailable, paused, ignoreSameMs, feedback });
  callbacks.current = { onDetect, onUnavailable, paused, ignoreSameMs, feedback };

  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: カメラは、画面の表示・やり直し・解読の方法が変わったときだけ、起動し直す
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    const fail = (reason: UnavailableReason) => {
      if (cancelled) return;
      setState({ kind: "unavailable", reason });
      callbacks.current.onUnavailable?.(reason);
    };

    const start = async () => {
      setState({ kind: "starting" });
      if (!window.isSecureContext) return fail("insecure");
      if (!navigator.mediaDevices?.getUserMedia) return fail("unsupported");

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // 背面カメラ。無ければ、ある方を使う（ideal）
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (error) {
        return fail(classifyCameraError(error));
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // 自動再生を止められても、映像は流れている。読み取りは続ける
      }

      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      setTorchSupported(supportsTorch(track));
      setTorchOn(false);

      const decoder = await createDecoder(decoderKind);
      if (cancelled) return;
      setState({ kind: "ready", decoder: decoder.kind });

      let busy = false;
      let last: LastDetection | undefined;
      timer = setInterval(async () => {
        // 前の解読が終わっていないときは、飛ばす（重なると、端末が追いつかない）
        if (busy || callbacks.current.paused || video.readyState < 2) return;
        busy = true;
        try {
          const text = await decoder.decode(video);
          if (!text) return;
          const now = Date.now();
          if (!shouldAccept(last, text, now, callbacks.current.ignoreSameMs)) return;
          last = { value: text, at: now };
          notifyDetected(callbacks.current.feedback);
          setFlash(true);
          clearTimeout(flashTimer);
          flashTimer = setTimeout(() => setFlash(false), FLASH_MS);
          callbacks.current.onDetect(text);
        } catch {
          // 1 コマの解読に失敗しても、次のコマを読む
        } finally {
          busy = false;
        }
      }, SCAN_INTERVAL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(flashTimer);
      for (const track of stream?.getTracks() ?? []) track.stop();
      trackRef.current = undefined;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [visible, attempt, decoderKind]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      // ライトを切り替えられなくても、読み取りは続けられる
    }
  };

  if (state.kind === "unavailable") {
    if (hideWhenUnavailable) return null;
    return (
      <div className="cb-scanner-unavailable">
        <Notice tone="error">{unavailableMessage(state.reason)}</Notice>
        {state.reason !== "insecure" && state.reason !== "unsupported" && (
          <Button variant="line" onClick={() => setAttempt((count) => count + 1)}>
            もう一度試す
          </Button>
        )}
      </div>
    );
  }

  const label = flash
    ? "読み取りました"
    : paused
      ? "いったん止めています"
      : state.kind === "starting"
        ? "カメラを起動しています…"
        : "QR を、枠に合わせてください";

  return (
    <section
      className="cb-scanner"
      data-state={state.kind}
      data-decoder={state.kind === "ready" ? state.decoder : undefined}
      data-flash={flash || undefined}
      aria-label="QR コードの読み取り"
    >
      <video ref={videoRef} className="cb-scanner__video" playsInline muted autoPlay />
      <div className="cb-scanner__frame" aria-hidden="true" />
      <p className="cb-scanner__hint" role="status">
        {label}
      </p>
      {torchSupported && (
        <Button
          variant="line"
          className="cb-scanner__torch"
          aria-pressed={torchOn}
          onClick={() => void toggleTorch()}
        >
          ライト
        </Button>
      )}
    </section>
  );
}
