import { describe, expect, test } from "bun:test";
import {
  classifyCameraError,
  fitSize,
  shouldAccept,
  type UnavailableReason,
  unavailableMessage,
} from "./scan-logic";

describe("同じ QR の二重処理を防ぐ", () => {
  const last = { value: "ORDER-A", at: 1000 };

  test("同じ値は、一定時間のあいだ無視する。時間がたてば、また受け付ける", () => {
    expect(shouldAccept(last, "ORDER-A", 1500, 3000)).toBe(false);
    expect(shouldAccept(last, "ORDER-A", 3999, 3000)).toBe(false);
    expect(shouldAccept(last, "ORDER-A", 4000, 3000)).toBe(true);
  });

  test("違う値は、すぐに受け付ける（次の人の QR に、すぐ切り替わる）", () => {
    expect(shouldAccept(last, "ORDER-B", 1001, 3000)).toBe(true);
  });

  test("最初の 1 回は、必ず受け付ける", () => {
    expect(shouldAccept(undefined, "ORDER-A", 0, 3000)).toBe(true);
  });
});

describe("カメラが使えない理由", () => {
  const named = (name: string) => ({ name });

  test("ブラウザのエラーを、してほしいことが違う理由に分ける", () => {
    expect(classifyCameraError(named("NotAllowedError"))).toBe("denied");
    expect(classifyCameraError(named("SecurityError"))).toBe("denied");
    expect(classifyCameraError(named("NotFoundError"))).toBe("no-camera");
    expect(classifyCameraError(named("OverconstrainedError"))).toBe("no-camera");
    expect(classifyCameraError(named("NotReadableError"))).toBe("in-use");
    expect(classifyCameraError(named("SomethingElse"))).toBe("error");
    expect(classifyCameraError(undefined)).toBe("error");
    expect(classifyCameraError("文字列")).toBe("error");
  });

  test("どの理由にも、してほしいことが書いてある（空でなく、叫ばず、理由ごとに違う）", () => {
    const reasons: UnavailableReason[] = [
      "insecure",
      "unsupported",
      "denied",
      "no-camera",
      "in-use",
      "error",
    ];
    const messages = reasons.map(unavailableMessage);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toContain("！");
    }
    expect(new Set(messages).size).toBe(reasons.length);
  });
});

describe("解読する前の縮小", () => {
  test("長いほうの辺が上限に収まる。縦横比は保ち、小さければ、そのまま", () => {
    expect(fitSize(1280, 720, 640)).toEqual({ width: 640, height: 360 });
    expect(fitSize(720, 1280, 640)).toEqual({ width: 360, height: 640 });
    expect(fitSize(320, 240, 640)).toEqual({ width: 320, height: 240 });
    expect(fitSize(0, 0, 640)).toEqual({ width: 0, height: 0 });
  });
});
