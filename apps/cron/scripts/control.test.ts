import { describe, expect, it } from "vitest";
import { callControl, webAppUrl } from "./control";

const respond = (body: string) => {
  const calls: { url: string; method: string | undefined; body: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method, body: String(init?.body) });
    return new Response(body);
  };
  return { calls, fetchImpl };
};

describe("callControl（ウェブアプリを呼ぶ）", () => {
  it("合言葉と操作を、POST のフォームで送り、JSON の結果を返す", async () => {
    const result = { ok: true, action: "health", running: true, intervalMinutes: 1 };
    const { calls, fetchImpl } = respond(JSON.stringify(result));

    expect(await callControl({ deploymentId: "AKfycbX", secret: "s3cret", action: "health", fetch: fetchImpl })).toEqual(result);
    expect(calls).toEqual([{ url: webAppUrl("AKfycbX"), method: "POST", body: "key=s3cret&action=health" }]);
  });

  it("JSON でない応答（権限が未許可の画面など）は、失敗として返す", async () => {
    const result = await callControl({ deploymentId: "d", secret: "x", action: "start", fetch: respond("<html>…</html>").fetchImpl });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("権限の許可");
  });
});
