import { describe, expect, it } from "vitest";
import { extractDeploymentId, setDeploymentId } from "./push";

describe("extractDeploymentId", () => {
  it("clasp create-deployment の出力から、AKfycb… を取り出す。なければ null", () => {
    expect(extractDeploymentId("Created version 1.\n- AKfycbwAbC-d_E123 @1 - UC cron\n")).toBe("AKfycbwAbC-d_E123");
    expect(extractDeploymentId("Error: something")).toBeNull();
  });
});

describe("setDeploymentId", () => {
  const config = 'export const A = "x";\nexport const WEB_APP_DEPLOYMENT_ID = "";\n';

  it("config.ts の WEB_APP_DEPLOYMENT_ID だけを書き換える", () => {
    expect(setDeploymentId(config, "AKfycbNEW")).toBe('export const A = "x";\nexport const WEB_APP_DEPLOYMENT_ID = "AKfycbNEW";\n');
    expect(setDeploymentId('export const WEB_APP_DEPLOYMENT_ID = "AKfycbOLD";', "AKfycbNEW")).toBe('export const WEB_APP_DEPLOYMENT_ID = "AKfycbNEW";');
  });

  it("見つからなければ null（書き換えない）", () => {
    expect(setDeploymentId("export const A = 1;", "AKfycbNEW")).toBeNull();
  });
});
