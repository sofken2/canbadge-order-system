import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildPath, type Endpoint, endpoints } from "./endpoints";

const list = Object.entries(endpoints) as [string, Endpoint][];

describe("エンドポイントの一覧", () => {
  test("メソッドとパスの組が重複しない", () => {
    const keys = list.map(([, e]) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("パスは /api から始まる", () => {
    for (const [, e] of list) expect(e.path.startsWith("/api/")).toBe(true);
  });

  test("access は、パスの接頭辞と一致する（スタッフ認証が一括で守れる）", () => {
    for (const [name, e] of list) {
      const expected = e.path.startsWith("/api/staff/")
        ? "staff"
        : e.path.startsWith("/api/monitor/")
          ? "monitor"
          : "visitor";
      expect({ name, access: e.access }).toEqual({ name, access: expected });
    }
  });

  test("パスの :name と params の項目が一致する", () => {
    for (const [name, e] of list) {
      const names = [...e.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1] ?? "").sort();
      if (names.length === 0) {
        expect({ name, params: e.params }).toEqual({ name, params: undefined });
        continue;
      }
      expect(e.params instanceof z.ZodObject).toBe(true);
      const keys = e.params instanceof z.ZodObject ? Object.keys(e.params.shape).sort() : [];
      expect({ name, keys }).toEqual({ name, keys: names });
    }
  });

  test("JSON でない応答（response が null）は、決まったものだけ", () => {
    const nonJson = list.filter(([, e]) => e.response === null).map(([name]) => name);
    expect(nonJson.sort()).toEqual(
      [
        "getImage",
        "getPrintSheetPdf",
        "discordAuthorize",
        "discordCallback",
        "orderEvents",
        "staffEvents",
        "monitorEvents",
      ].sort(),
    );
  });

  test("SSE の購読は、イベントの形（stream）を持つ", () => {
    for (const [name, e] of list) {
      if (e.path.includes("/events"))
        expect({ name, stream: !!e.stream }).toEqual({ name, stream: true });
    }
  });
});

describe("buildPath", () => {
  test(":name を値に置き換え、URL エンコードする", () => {
    expect(
      buildPath("/api/orders/:orderId/cancel", { orderId: "01HZX3V5Q8N4M6T2B9C7D1E0FA" }),
    ).toBe("/api/orders/01HZX3V5Q8N4M6T2B9C7D1E0FA/cancel");
    expect(buildPath("/api/images/:imageId", { imageId: "a/b" })).toBe("/api/images/a%2Fb");
  });

  test("引数が足りなければ例外", () => {
    expect(() => buildPath("/api/orders/:orderId")).toThrow();
  });
});
