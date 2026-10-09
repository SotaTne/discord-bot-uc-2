import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SECRETS, SecretError, buildSecretsFile } from "../.github/scripts/write-secrets";

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

describe("SECRETS と、CD のワークフロー", () => {
  const workflow = readFileSync(new URL("../.github/workflows/cd.yml", import.meta.url), "utf8");

  it("渡す秘密は、すべて、deploy ジョブの env に、GitHub の Secrets から入る（足し忘れると、Worker に渡らない）", () => {
    for (const name of [...SECRETS.required, ...SECRETS.optional]) {
      expect(workflow, name).toContain(`${name}: \${{ secrets.${name} }}`);
    }
  });
});
