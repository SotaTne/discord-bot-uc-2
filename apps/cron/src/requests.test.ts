import { describe, expect, it } from "vitest";
import { buildRequests, describeResponse } from "./requests";
import { TARGETS } from "./targets";

const staging = TARGETS[0]!;

describe("buildRequests", () => {
  it("合言葉があるところだけ、Bearer を付けた POST を作る。ないところは、missing に入れる", () => {
    const { requests, missing } = buildRequests(TARGETS, (property) => (property === staging.secretProperty ? "s3cret" : null));

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: staging.url, options: { method: "post", headers: { Authorization: "Bearer s3cret" }, muteHttpExceptions: true } });
    expect(missing.map((target) => target.name)).toEqual(["production"]);
  });

  it("空の合言葉は、ないものとして扱う", () => {
    expect(buildRequests(TARGETS, () => "").requests).toEqual([]);
  });
});

describe("TARGETS", () => {
  it("URL は、https の /cron で終わり、プロパティの名前は、重ならない", () => {
    for (const target of TARGETS) expect(new URL(target.url)).toMatchObject({ protocol: "https:", pathname: "/cron" });
    expect(new Set(TARGETS.map((target) => target.secretProperty)).size).toBe(TARGETS.length);
  });
});

describe("describeResponse", () => {
  it("何も起きなかったときは null（ログを増やさない）", () => {
    expect(describeResponse(staging, 200, JSON.stringify({ ran: [], errors: [] }))).toBeNull();
  });
  it("実行があれば、そのジョブを出す。失敗があれば、失敗を出す", () => {
    expect(describeResponse(staging, 200, JSON.stringify({ ran: ["recruit:2026-10-07"], errors: [] }))).toBe("staging: 実行 recruit:2026-10-07");
    expect(describeResponse(staging, 200, JSON.stringify({ ran: [], errors: ["g: boom"] }))).toBe("staging: ジョブの失敗 g: boom");
  });
  it("200 でない・読めない応答は、必ず出す", () => {
    expect(describeResponse(staging, 401, '{"error":"unauthorized"}')).toContain("HTTP 401");
    expect(describeResponse(staging, 200, "<html>")).toContain("読めません");
  });
});
