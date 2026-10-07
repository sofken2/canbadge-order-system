import { describe, expect, test } from "bun:test";
import { discordErrorMessage, readDiscordReturn } from "./discord-return";

const ID = "01HZX3V5Q8N4M6T2B9C7D1E0FA";

describe("Discord からの戻りを読む", () => {
  test("画像 ID が付いていれば、取り込めた", () => {
    expect(readDiscordReturn(`?imageId=${ID}`)).toEqual({ imageId: ID });
  });

  test("discordError が付いていれば、失敗（理由つき）", () => {
    expect(readDiscordReturn("?discordError=denied")).toEqual({ error: "denied" });
  });

  test("Discord の戻りでなければ、undefined", () => {
    expect(readDiscordReturn("")).toBeUndefined();
    expect(readDiscordReturn("?utm_source=x")).toBeUndefined();
  });

  test("画像 ID の形が違うもの（URL・パスの書き換え）は、通さない", () => {
    expect(readDiscordReturn("?imageId=../../etc/passwd")).toBeUndefined();
    expect(readDiscordReturn("?imageId=https://example.com/a.png")).toBeUndefined();
    expect(readDiscordReturn("?imageId=short")).toBeUndefined();
  });

  test("両方あれば、失敗を優先する", () => {
    expect(readDiscordReturn(`?imageId=${ID}&discordError=state`)).toEqual({ error: "state" });
  });
});

describe("失敗の文", () => {
  test("理由ごとに、何が起きたかと、次の手を伝える", () => {
    for (const code of ["denied", "state", "no_avatar", "image", "rate", "unavailable"]) {
      expect(discordErrorMessage(code).length).toBeGreaterThan(10);
    }
    expect(discordErrorMessage("no_avatar")).toContain("アイコン");
    expect(discordErrorMessage("denied")).toContain("手元の画像");
  });

  test("知らない理由でも、使えないことを伝える。仕組みの語（トークン・state）は、見せない", () => {
    expect(discordErrorMessage("なにか-新しい-理由")).toBe(discordErrorMessage("unavailable"));
    for (const code of ["denied", "state", "no_avatar", "image", "rate", "unavailable"]) {
      expect(discordErrorMessage(code)).not.toMatch(/トークン|token|OAuth|secret/i);
    }
  });
});
