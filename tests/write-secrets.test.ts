import { describe, expect, it } from "vitest";
import { SecretError, UsageError, buildSecretsFile, parseArgs } from "../.github/scripts/write-secrets";

describe("parseArgs（--required / --optional）", () => {
  it("名前を、必須と任意に分けて読む", () => {
    expect(parseArgs(["--required", "A_TOKEN", "--optional", "B_SECRET", "--required", "C"])).toEqual({ required: ["A_TOKEN", "C"], optional: ["B_SECRET"] });
  });

  it("知らないオプション・名前がない・名前の形が違うときは、UsageError", () => {
    expect(() => parseArgs(["--mandatory", "A"])).toThrow(UsageError);
    expect(() => parseArgs(["--required"])).toThrow(UsageError);
    expect(() => parseArgs(["--required", "a b"])).toThrow(UsageError);
  });
});

describe("buildSecretsFile（wrangler の --secrets-file の中身）", () => {
  const spec = { required: ["A_TOKEN"], optional: ["B_SECRET"] };

  it("必須と任意の秘密を、NAME=value の行で書く。値の記号（% や \\）は、そのまま", () => {
    expect(buildSecretsFile(spec, { A_TOKEN: "a%b\\c", B_SECRET: "bbb" })).toBe("A_TOKEN=a%b\\c\nB_SECRET=bbb\n");
  });

  it("任意の秘密が空・未設定なら、書かない", () => {
    expect(buildSecretsFile(spec, { A_TOKEN: "a", B_SECRET: "" })).toBe("A_TOKEN=a\n");
    expect(buildSecretsFile(spec, { A_TOKEN: "a" })).toBe("A_TOKEN=a\n");
  });

  it("必須の秘密が空・未設定なら、名前つきの SecretError", () => {
    expect(() => buildSecretsFile(spec, { A_TOKEN: "" })).toThrow(SecretError);
    expect(() => buildSecretsFile(spec, {})).toThrow("A_TOKEN");
  });

  it("値に改行があるときは、断る（別の名前の秘密として、読まれてしまうため）", () => {
    expect(() => buildSecretsFile(spec, { A_TOKEN: "a\nB_SECRET=evil" })).toThrow("改行");
    expect(() => buildSecretsFile(spec, { A_TOKEN: "a", B_SECRET: "b\r\nC=d" })).toThrow(SecretError);
  });
});
