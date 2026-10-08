import type { InferResponseType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createApiClient } from "./api";

describe("createApiClient", () => {
  it("health を GET すると、/api/health にリクエストして型付きで結果を受け取る", async () => {
    const requested: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      requested.push(String(input instanceof Request ? input.url : input));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = createApiClient("http://dashboard.example/api", { fetch: fetchImpl });

    const response = await client.health.$get();
    const body = await response.json();

    expect(requested).toEqual(["http://dashboard.example/api/health"]);
    expect(body).toEqual({ ok: true });
  });

  it("レスポンスの型が worker の定義から推論される（型の確認は pnpm typecheck で行われる）", () => {
    const client = createApiClient();
    type Health = InferResponseType<typeof client.health.$get>;
    expectTypeOf<Health>().toEqualTypeOf<{ ok: true }>();
  });
});
