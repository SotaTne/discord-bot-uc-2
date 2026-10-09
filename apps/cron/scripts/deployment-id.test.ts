import { describe, expect, it } from "vitest";
import { parseDeployments, pickDeploymentId } from "./deployment-id";

const output = "2 Deployments.\n- AKfycbHEAD123 @HEAD\n- AKfycbWEB-456_x @3 - UC cron\n";

describe("parseDeployments", () => {
  it("作業中の版（@HEAD）を除いて、デプロイの ID と版を読む", () => {
    expect(parseDeployments(output)).toEqual([{ id: "AKfycbWEB-456_x", version: "3" }]);
  });
  it("読めない出力は、空", () => {
    expect(parseDeployments("Error: not logged in")).toEqual([]);
  });
});

describe("pickDeploymentId", () => {
  it("ちょうど 1 つなら、その ID", () => {
    expect(pickDeploymentId([{ id: "AKfycbA" }])).toEqual({ id: "AKfycbA" });
  });
  it("0 個なら、先に push する案内。2 個以上なら、一覧を出して、止める", () => {
    expect(pickDeploymentId([])).toMatchObject({ error: expect.stringContaining("pnpm push") });
    expect(pickDeploymentId([{ id: "AKfycbA" }, { id: "AKfycbB" }])).toMatchObject({ error: expect.stringContaining("AKfycbA / AKfycbB") });
  });
});
