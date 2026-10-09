import { describe, expect, it } from "vitest";
import { ENVIRONMENTS, generateSecret, nextSteps, plan } from "../scripts/update-cron-secret";

describe("generateSecret", () => {
  it("十分に長い、URL にも使える文字だけの値を、毎回、別に作る", () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateSecret()));
    expect(secrets.size).toBe(20);
    for (const secret of secrets) expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("実行前の表示と、次にやること", () => {
  it("デプロイは、しないと、先に伝える。両方の環境を対象にする", () => {
    expect(ENVIRONMENTS).toEqual(["staging", "production"]);
    expect(plan().join("\n")).toContain("デプロイは、しない");
    expect(plan().join("\n")).toContain("初回");
    expect(nextSteps(true).join("\n")).toContain("cd を、develop と main の両方で");
  });

  it("Apps Script を自動で取り替えたときは、手で貼る手順が、入らない", () => {
    expect(nextSteps(true).join("\n")).not.toContain("スクリプト プロパティ");
    expect(nextSteps(false).join("\n")).toContain("スクリプト プロパティ");
  });
});
