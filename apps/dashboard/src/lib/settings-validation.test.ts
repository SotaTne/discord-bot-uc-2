import { describe, expect, it } from "vitest";
import { validatePoints, validateChannelId, validateCutoffMinutes, validateFixedAfterMatches, validateFixedPoints, validateRecruitHour } from "./settings-validation";

describe("設定の入力の検証", () => {
  it("募集開始時刻は、0〜23 の整数", () => {
    expect(validateRecruitHour("0")).toBeUndefined();
    expect(validateRecruitHour("23")).toBeUndefined();
    expect(validateRecruitHour("24")).toBe("23 以下にしてください");
    expect(validateRecruitHour("")).toBe("数字を入力してください");
    expect(validateRecruitHour("1.5")).toBe("0 以上の整数を入力してください");
    expect(validateRecruitHour("-1")).toBe("0 以上の整数を入力してください");
  });

  it("締切は、1〜180 の整数", () => {
    expect(validateCutoffMinutes("1")).toBeUndefined();
    expect(validateCutoffMinutes("180")).toBeUndefined();
    expect(validateCutoffMinutes("0")).toBe("1 以上にしてください");
    expect(validateCutoffMinutes("181")).toBe("180 以下にしてください");
  });

  it("N は 0〜100、固定点は 0 以上", () => {
    expect(validateFixedAfterMatches("0")).toBeUndefined();
    expect(validateFixedAfterMatches("101")).toBe("100 以下にしてください");
    expect(validateFixedPoints("0")).toBeUndefined();
    expect(validateFixedPoints("100000")).toBeUndefined();
    expect(validateFixedPoints("100001")).toBe("100000 以下にしてください");
    expect(validateFixedPoints("abc")).toBe("0 以上の整数を入力してください");
  });

  it("勝利の点数は、0〜100000 の整数", () => {
    expect(validatePoints("0")).toBeUndefined();
    expect(validatePoints("100000")).toBeUndefined();
    expect(validatePoints("100001")).toBe("100000 以下にしてください");
    expect(validatePoints("10000000000000000000")).toBe("100000 以下にしてください");
    expect(validatePoints("-5")).toBe("0 以上の整数を入力してください");
    expect(validatePoints("1.5")).toBe("0 以上の整数を入力してください");
  });

  it("チャンネル ID は、空か、15〜25 桁の数字", () => {
    expect(validateChannelId("")).toBeUndefined();
    expect(validateChannelId(" 300000000000000001 ")).toBeUndefined();
    expect(validateChannelId("12345")).toContain("チャンネル ID");
    expect(validateChannelId("abc")).toContain("チャンネル ID");
  });
});
