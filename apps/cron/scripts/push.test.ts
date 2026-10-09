import { describe, expect, it } from "vitest";
import { extractDeploymentId } from "./push";

describe("extractDeploymentId", () => {
  it("clasp create-deployment の出力から、AKfycb… を取り出す。なければ null", () => {
    expect(extractDeploymentId("Created version 1.\n- AKfycbwAbC-d_E123 @1 - UC cron\n")).toBe("AKfycbwAbC-d_E123");
    expect(extractDeploymentId("Error: something")).toBeNull();
  });
});
