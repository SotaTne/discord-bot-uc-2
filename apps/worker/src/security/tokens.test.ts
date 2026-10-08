import { describe, expect, it } from "vitest";
import { generateToken, sha256Hex } from "./tokens";

describe("generateToken", () => {
  it("URL に入れられる文字だけで、32 バイトなら 43 文字になる", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).toHaveLength(43);
  });

  it("呼ぶたびに別の値になる", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("sha256Hex", () => {
  it("既知の値と一致する", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("同じ入力なら同じ値、違う入力なら違う値", async () => {
    expect(await sha256Hex("a")).toBe(await sha256Hex("a"));
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });
});
