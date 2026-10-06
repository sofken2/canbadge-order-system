import { describe, expect, test } from "bun:test";
import { classifyOrigin, isLoopback, nearestForwardedAddress } from "./origin";

const headers = (init: Record<string, string> = {}) => new Headers(init);

describe("localhost の判定", () => {
  test("127.x.x.x・::1・IPv4 射影のアドレスは localhost。それ以外は違う", () => {
    for (const address of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", " 127.0.0.1 "]) {
      expect(isLoopback(address)).toBe(true);
    }
    for (const address of [
      "192.168.1.5",
      "10.0.0.1",
      "172.16.0.9",
      "8.8.8.8",
      "::2",
      "1127.0.0.1",
    ]) {
      expect(isLoopback(address)).toBe(false);
    }
  });

  test("X-Forwarded-For は、いちばん右（近いプロキシが見た接続元）を使う", () => {
    expect(nearestForwardedAddress("1.1.1.1, 192.168.0.9")).toBe("192.168.0.9");
    expect(nearestForwardedAddress("127.0.0.1")).toBe("127.0.0.1");
    expect(nearestForwardedAddress("")).toBeUndefined();
    expect(nearestForwardedAddress(undefined)).toBeUndefined();
  });
});

describe("経路の判定", () => {
  test("cf-ray か cf-connecting-ip があれば、Cloudflare 経由（接続元が localhost でも）", () => {
    expect(
      classifyOrigin({ headers: headers({ "cf-ray": "abc-NRT" }), remoteAddress: "127.0.0.1" }),
    ).toBe("cloudflare");
    expect(
      classifyOrigin({
        headers: headers({ "cf-connecting-ip": "203.0.113.5" }),
        remoteAddress: "127.0.0.1",
      }),
    ).toBe("cloudflare");
  });

  test("ヘッダーなし・接続元が localhost なら、localhost", () => {
    expect(classifyOrigin({ headers: headers(), remoteAddress: "127.0.0.1" })).toBe("local");
    expect(classifyOrigin({ headers: headers(), remoteAddress: "::1" })).toBe("local");
  });

  test("接続元がわからない（テストなど）ときは、localhost として扱う", () => {
    expect(classifyOrigin({ headers: headers(), remoteAddress: undefined })).toBe("local");
  });

  test("接続元が LAN のアドレスなら、LAN（api に直接つないだ場合）", () => {
    expect(classifyOrigin({ headers: headers(), remoteAddress: "192.168.1.20" })).toBe("lan");
  });

  test("Caddy 経由：api への接続は localhost だが、X-Forwarded-For の右端が LAN なら LAN", () => {
    expect(
      classifyOrigin({
        headers: headers({ "x-forwarded-for": "192.168.1.20" }),
        remoteAddress: "127.0.0.1",
      }),
    ).toBe("lan");
  });

  test("X-Forwarded-For の左側を、127.0.0.1 に偽っても、右端（実際の接続元）で判定する", () => {
    expect(
      classifyOrigin({
        headers: headers({ "x-forwarded-for": "127.0.0.1, 192.168.1.20" }),
        remoteAddress: "127.0.0.1",
      }),
    ).toBe("lan");
  });

  test("Caddy 経由で、その PC の中から来たなら、localhost", () => {
    expect(
      classifyOrigin({
        headers: headers({ "x-forwarded-for": "127.0.0.1" }),
        remoteAddress: "127.0.0.1",
      }),
    ).toBe("local");
  });

  test("LAN の人が、cf-ray を偽って付けても、Cloudflare 経由として扱う（JWT が要る、より厳しい側）", () => {
    expect(
      classifyOrigin({ headers: headers({ "cf-ray": "fake" }), remoteAddress: "192.168.1.20" }),
    ).toBe("cloudflare");
  });
});
