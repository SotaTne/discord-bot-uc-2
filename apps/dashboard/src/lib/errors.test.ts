import { describe, expect, it } from "vitest";
import { ApiError, errorMessage, unwrap } from "./errors";

const response = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("unwrap", () => {
  it("成功したときは、本文を返す", async () => {
    await expect(unwrap(response(200, { ok: true }))).resolves.toEqual({ ok: true });
    await expect(unwrap(response(201, { id: 3 }))).resolves.toEqual({ id: 3 });
  });

  it("失敗したときは、ステータスとエラーコードを持つ ApiError を投げる", async () => {
    const error = await unwrap(response(409, { error: "already_exists" })).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "already_exists" });
  });

  it("本文が JSON でない・エラーコードがないときも、ApiError になる（code は unknown）", async () => {
    const notJson = await unwrap(Promise.resolve(new Response("oops", { status: 500 }))).catch((e: unknown) => e);
    const validation = await unwrap(response(400, { success: false, error: { name: "ZodError" } })).catch((e: unknown) => e);

    expect(notJson).toMatchObject({ status: 500, code: "unknown" });
    expect(validation).toMatchObject({ status: 400, code: "unknown" });
  });
});

describe("errorMessage", () => {
  it("エラーコードに応じた、分かりやすい文面にする", () => {
    expect(errorMessage(new ApiError(409, "already_exists"))).toBe("すでに登録されています");
    expect(errorMessage(new ApiError(401, "unauthorized"))).toContain("/uc-admin-dashboard");
  });

  it("入力の検証エラー（400）は、入力内容の確認を促す", () => {
    expect(errorMessage(new ApiError(400, "unknown"))).toBe("入力内容を確認してください");
  });

  it("知らないコードは、ステータスを添える。通信の失敗は、再試行を促す", () => {
    expect(errorMessage(new ApiError(500, "unknown"))).toBe("エラーが発生しました（500）");
    expect(errorMessage(new TypeError("Failed to fetch"))).toContain("通信に失敗しました");
  });
});
