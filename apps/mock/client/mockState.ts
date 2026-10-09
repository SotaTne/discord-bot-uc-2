import { useQuery } from "@tanstack/react-query";
import type { InferResponseType } from "hono/client";
import { mockApi } from "./api";

export type MockStateData = InferResponseType<typeof mockApi.state.$get>;
export type MockMessage = MockStateData["messages"][number];
export type MockUser = MockStateData["users"][number];
export type Snapshot = NonNullable<MockStateData["snapshot"]>;

export const STATE_KEY = ["mock-state"] as const;

/** 画面に出すものを、まとめて取る。2 秒ごとに、取り直す（worker の cron や、別の操作の結果が、自動で出る） */
export const useMockState = () =>
  useQuery({
    queryKey: STATE_KEY,
    queryFn: async () => {
      const response = await mockApi.state.$get();
      if (!response.ok) throw new Error(`疑似 Discord のサーバーが ${response.status} を返しました`);
      return response.json();
    },
    refetchInterval: 2000,
  });

/** ユーザー ID を、表示名にする（知らない ID は、そのまま） */
export const userName = (state: Pick<MockStateData, "users">, id: string) => state.users.find((user) => user.id === id)?.username ?? id;
