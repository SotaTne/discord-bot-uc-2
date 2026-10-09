import { describe, expect, it } from "vitest";
import { isAuthorizedKey } from "./auth";

describe("isAuthorizedKey（ウェブアプリの合言葉の確認）", () => {
  it("同じ合言葉だけ、true", () => {
    expect(isAuthorizedKey("s3cret", "s3cret")).toBe(true);
    expect(isAuthorizedKey("s3cre", "s3cret")).toBe(false);
    expect(isAuthorizedKey("s3cretX", "s3cret")).toBe(false);
    expect(isAuthorizedKey("S3CRET", "s3cret")).toBe(false);
  });

  it("合言葉が未設定（null・空）なら、何を送られても false。送られていないときも false", () => {
    expect(isAuthorizedKey("", "")).toBe(false);
    expect(isAuthorizedKey("x", null)).toBe(false);
    expect(isAuthorizedKey("x", undefined)).toBe(false);
    expect(isAuthorizedKey(undefined, "s3cret")).toBe(false);
  });
});
