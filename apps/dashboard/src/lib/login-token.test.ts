import { describe, expect, it } from "vitest";
import { parseLoginToken } from "./login-token";

const token = "abcDEF0123456789_-abcDEF0123456789_-abcdefg";

describe("parseLoginToken", () => {
  it("# 付きのフラグメントからトークンを取り出す", () => {
    expect(parseLoginToken(`#token=${token}`)).toBe(token);
  });

  it("# がなくても取り出せる", () => {
    expect(parseLoginToken(`token=${token}`)).toBe(token);
  });

  it("ほかのパラメータが混ざっていても取り出せる", () => {
    expect(parseLoginToken(`#foo=1&token=${token}`)).toBe(token);
  });

  it("トークンがなければ null", () => {
    expect(parseLoginToken("")).toBeNull();
    expect(parseLoginToken("#")).toBeNull();
    expect(parseLoginToken("#other=1")).toBeNull();
  });

  it("短すぎるトークンは null", () => {
    expect(parseLoginToken("#token=short")).toBeNull();
  });
});
