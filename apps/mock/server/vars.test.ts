import { describe, expect, it } from "vitest";
import { applyPublicKey, ensureEnvVar } from "./vars";

const KEY = "abcdef0123456789";

describe("applyPublicKey", () => {
  it("値が空の行に、公開鍵を設定する（ほかの行はそのまま）", () => {
    const text = "# コメント\nDISCORD_PUBLIC_KEY=\nDISCORD_BOT_TOKEN=dev-token\n";

    const result = applyPublicKey(text, KEY);

    expect(result.status).toBe("set");
    expect(result.text).toBe(`# コメント\nDISCORD_PUBLIC_KEY=${KEY}\nDISCORD_BOT_TOKEN=dev-token\n`);
  });

  it("行がなければ、末尾に追加する（改行がなくても行が壊れない）", () => {
    expect(applyPublicKey("DISCORD_BOT_TOKEN=x", KEY).text).toBe(`DISCORD_BOT_TOKEN=x\nDISCORD_PUBLIC_KEY=${KEY}\n`);
    expect(applyPublicKey("", KEY).text).toBe(`DISCORD_PUBLIC_KEY=${KEY}\n`);
  });

  it("すでに同じ値なら、何も変えない", () => {
    const text = `DISCORD_PUBLIC_KEY=${KEY}\n`;
    expect(applyPublicKey(text, KEY)).toEqual({ text, status: "unchanged" });
  });

  it("別の値（本物の Discord の公開鍵など）が入っていれば、上書きせず残す", () => {
    const text = "DISCORD_PUBLIC_KEY=realkey123\n";
    expect(applyPublicKey(text, KEY)).toEqual({ text, status: "kept-existing" });
  });

  it("force なら、別の値でもモックの公開鍵で上書きする", () => {
    const result = applyPublicKey("DISCORD_PUBLIC_KEY=realkey123\nOTHER=1\n", KEY, true);
    expect(result).toEqual({ text: `DISCORD_PUBLIC_KEY=${KEY}\nOTHER=1\n`, status: "set" });
  });

  it("名前が似ている別の変数は書き換えない", () => {
    const text = "DISCORD_PUBLIC_KEY_OLD=old\nDISCORD_PUBLIC_KEY=\n";
    expect(applyPublicKey(text, KEY).text).toBe(`DISCORD_PUBLIC_KEY_OLD=old\nDISCORD_PUBLIC_KEY=${KEY}\n`);
  });
});

describe("ensureEnvVar", () => {
  it("なければ追加する（改行がなくても行が壊れない）", () => {
    expect(ensureEnvVar("A=1\n", "DEV_CLOCK", "true")).toEqual({ text: "A=1\nDEV_CLOCK=true\n", added: true });
    expect(ensureEnvVar("A=1", "DEV_CLOCK", "true").text).toBe("A=1\nDEV_CLOCK=true\n");
    expect(ensureEnvVar("", "DEV_CLOCK", "true").text).toBe("DEV_CLOCK=true\n");
  });

  it("すでにあれば、値が違っても変えない", () => {
    const text = "DEV_CLOCK=false\n";
    expect(ensureEnvVar(text, "DEV_CLOCK", "true")).toEqual({ text, added: false });
  });

  it("名前が似ている別の変数は、あるものとして扱わない", () => {
    expect(ensureEnvVar("DEV_CLOCK_X=1\n", "DEV_CLOCK", "true").added).toBe(true);
  });
});
