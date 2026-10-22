import { describe, expect, test } from "bun:test";
import { clearPublishOffer, readPublishOffer, savePublishOffer } from "./publish-offer";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => void map.set(k, v),
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe("注文のあとの、公開の案内", () => {
  test("注文ごとに残して読める。読んでも消えず、消すまで出る", () => {
    const storage = fakeStorage();
    savePublishOffer("A1", { imageId: "img-1", editorData: { version: 1, layers: [] } }, storage);
    expect(readPublishOffer("A1", storage)).toEqual({
      imageId: "img-1",
      editorData: { version: 1, layers: [] },
    });
    expect(readPublishOffer("A1", storage)).toBeDefined();
    expect(readPublishOffer("B2", storage)).toBeUndefined();
    clearPublishOffer("A1", storage);
    expect(readPublishOffer("A1", storage)).toBeUndefined();
  });

  test("形が違うもの・壊れたものは、出さない", () => {
    const storage = fakeStorage();
    storage.setItem("canbadge-publish-offer:A1", "{broken");
    expect(readPublishOffer("A1", storage)).toBeUndefined();
    storage.setItem("canbadge-publish-offer:A1", JSON.stringify({ editorData: { version: 1 } }));
    expect(readPublishOffer("A1", storage)).toBeUndefined();
    // デザインの中身が契約の形でない（version がない）
    storage.setItem(
      "canbadge-publish-offer:A1",
      JSON.stringify({ imageId: "img-1", editorData: {} }),
    );
    expect(readPublishOffer("A1", storage)).toBeUndefined();
  });
});
