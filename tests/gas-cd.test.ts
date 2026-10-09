import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRED_ENV, buildClaspFiles } from "../.github/scripts/gas-prepare";
import { ensureTrigger, webAppUrl } from "../.github/scripts/gas-ensure-trigger";
import { checkDeployments } from "../.github/scripts/gas-verify";
import { StepError, requireEnv } from "../.github/scripts/support";

const env = { CLASPRC_JSON: '{"tokens":{"default":{"refresh_token":"r"}}}', CRON_SECRET: "s", GAS_SCRIPT_ID: "script-1", GAS_DEPLOYMENT_ID: "AKfycbDEPLOY" };

describe("requireEnv", () => {
  it("足りない名前を、全部、メッセージに入れる", () => {
    expect(() => requireEnv({ A: "a" }, ["A", "B", "C"], "ヒント")).toThrow("B・C が、登録されていません（ヒント）");
  });
  it("空の値も、足りないとみなす", () => {
    expect(() => requireEnv({ A: "" }, ["A"], "ヒント")).toThrow(StepError);
    expect(requireEnv({ A: "a" }, ["A"], "ヒント")).toEqual({ A: "a" });
  });
});

describe("gas-prepare（clasp の設定ファイル）", () => {
  it("ログイン情報は、そのまま。プロジェクトの設定は、ID と置くフォルダ（dist）", () => {
    const files = buildClaspFiles(env);
    expect(files.clasprc).toBe(env.CLASPRC_JSON);
    expect(JSON.parse(files.project)).toEqual({ scriptId: "script-1", rootDir: "dist" });
  });

  it("ID に、引用符などが入っていても、JSON が壊れない", () => {
    expect(JSON.parse(buildClaspFiles({ ...env, GAS_SCRIPT_ID: 'a"b' }).project)).toMatchObject({ scriptId: 'a"b' });
  });

  it("足りない設定・JSON でないログイン情報は、止める", () => {
    for (const name of REQUIRED_ENV) expect(() => buildClaspFiles({ ...env, [name]: "" }), name).toThrow(name);
    expect(() => buildClaspFiles({ ...env, CLASPRC_JSON: "not json" })).toThrow("JSON ではありません");
  });
});

describe("gas-verify（デプロイの存在）", () => {
  const output = "2 Deployments.\n- AKfycbHEAD @HEAD\n- AKfycbDEPLOY @3 - UC cron\n";
  it("デプロイの ID が、一覧にあれば、通る。なければ、止める", () => {
    expect(() => checkDeployments(output, "AKfycbDEPLOY")).not.toThrow();
    expect(() => checkDeployments(output, "AKfycbOTHER")).toThrow("deployment をして");
  });
});

describe("gas-ensure-trigger（毎分のトリガーの保証）", () => {
  const respond = (body: string) => {
    const calls: { url: string; method: string | undefined; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method, body: String(init?.body) });
      return new Response(body);
    };
    return { calls, fetchImpl };
  };

  it("ウェブアプリに、合言葉を POST する。「ok」が返れば、成功", async () => {
    const { calls, fetchImpl } = respond("ok\n");
    await ensureTrigger({ deploymentId: "AKfycbDEPLOY", secret: "s3cret", fetch: fetchImpl });
    expect(calls).toEqual([{ url: webAppUrl("AKfycbDEPLOY"), method: "POST", body: "key=s3cret" }]);
  });

  it("「ok」以外（合言葉の違い・権限が未許可の HTML など）は、止める", async () => {
    await expect(ensureTrigger({ deploymentId: "d", secret: "x", fetch: respond("unauthorized").fetchImpl })).rejects.toThrow("unauthorized");
    await expect(ensureTrigger({ deploymentId: "d", secret: "x", fetch: respond("<html>…</html>").fetchImpl })).rejects.toThrow(StepError);
  });
});

describe("gas-cd.yml", () => {
  const workflow = readFileSync(new URL("../.github/workflows/gas-cd.yml", import.meta.url), "utf8");

  it("スクリプトが読む設定（REQUIRED_ENV）は、deploy ジョブの env に、入る", () => {
    for (const name of REQUIRED_ENV) expect(workflow, name).toMatch(new RegExp(`${name}: \\$\\{\\{ (secrets|vars)\\.${name} \\}\\}`));
  });

  it("使うスクリプトが、実在する", () => {
    for (const [, file] of workflow.matchAll(/\.github\/scripts\/([\w-]+\.ts)/g)) {
      expect(() => readFileSync(new URL(`../.github/scripts/${file}`, import.meta.url)), file).not.toThrow();
    }
  });
});

describe(".github/scripts", () => {
  it("相対の import は、拡張子（.ts）つき（vitest は、なくても読めるが、CD の node は、なければ、読めない）", () => {
    const dir = new URL("../.github/scripts/", import.meta.url);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
      for (const [, path] of readFileSync(new URL(file, dir), "utf8").matchAll(/from "(\.[^"]*)"/g)) {
        expect(path, `${file}: ${path}`).toMatch(/\.ts$/);
      }
    }
  });
});
