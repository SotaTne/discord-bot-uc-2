import { describe, expect, it } from "vitest";
import { ENTRY_FUNCTIONS, bundleScript } from "./bundle";

describe("bundleScript", () => {
  it("Apps Script が探す、トップレベルの関数の宣言が、行頭に出る（エディタの一覧と、トリガーが使う）", async () => {
    const code = await bundleScript();
    for (const name of ENTRY_FUNCTIONS) expect(code, name).toMatch(new RegExp(`^function ${name}\\(\\)`, "m"));
  });

  it("秘密の値や、コードに書いた URL 以外は、入らない（合言葉は、スクリプトのプロパティから読む）", async () => {
    expect(await bundleScript()).not.toMatch(/Bearer [A-Za-z0-9]{8,}/);
  });
});
