import { vi } from "vitest";
import type { MockStateData } from "../mockState";

type Responder = { status?: number; body?: unknown } | ((request: { form: Record<string, string> }) => { status?: number; body?: unknown });
export type RecordedCall = { method: string; path: string; form: Record<string, string> };

/**
 * 疑似 Discord のサーバー（画面用の API）の代わりになる、テスト用の通信。
 * "GET /mock-api/state" のように、メソッドとパスで、返すものを決める。決めていない呼び出しがあれば、失敗させる。
 */
export function installFakeApi(routes: Record<string, Responder>) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), "http://mock.test");
    const method = (init?.method ?? "GET").toUpperCase();
    const form: Record<string, string> = {};
    if (init?.body instanceof FormData) for (const [key, value] of init.body.entries()) form[key] = value instanceof File ? `file:${value.name}` : value;
    calls.push({ method, path: url.pathname, form });

    const responder = routes[`${method} ${url.pathname}`];
    if (!responder) throw new Error(`テストで用意していない呼び出しです: ${method} ${url.pathname}`);
    const result = typeof responder === "function" ? responder({ form }) : responder;
    return new Response(JSON.stringify(result.body ?? null), { status: result.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  return {
    calls,
    callsTo: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path),
  };
}

const ids = { alice: "500000000000000001", carol: "500000000000000003", admin: "500000000000000005" };
export const USER_IDS = ids;
const jst = (text: string) => Date.parse(`${text}+09:00`);

/** 画面に出す状態のサンプル（20:53。21 時の締切が、いま実行できる） */
export function sampleState(over: Partial<MockStateData> = {}): MockStateData {
  return {
    guildId: "200000000000000001",
    channelId: "300000000000000001",
    users: [
      { id: ids.alice, username: "alice (KMU)", roleIds: ["400000000000000001"], isAdmin: false },
      { id: ids.carol, username: "carol (UT)", roleIds: ["400000000000000002"], isAdmin: false },
      { id: ids.admin, username: "admin", roleIds: [], isAdmin: true },
    ],
    roles: [
      { id: "400000000000000001", name: "KMU", position: 1 },
      { id: "400000000000000002", name: "UT", position: 2 },
    ],
    messages: [],
    // 本物の時刻より、8 時間進めている（動いている）
    clock: { now: jst("2026-10-07T20:53:00"), real: false, offsetMs: 8 * 3_600_000 + 12 * 60_000 },
    clockSteps: [
      { at: jst("2026-10-07T12:00:00"), label: "12:00 募集開始" },
      { at: jst("2026-10-07T20:53:00"), label: "20:53 21時の締切" },
      { at: jst("2026-10-07T21:00:00"), label: "21:00 21時の試合開始" },
    ],
    snapshot: {
      now: new Date(jst("2026-10-07T20:53:00")).toISOString(),
      clock: { offsetMs: 8 * 3_600_000 + 12 * 60_000 },
      today: "2026-10-07",
      settings: { channelId: "300000000000000001", recruitHour: 12, cutoffMinutes: 7, fixedAfterMatches: 5, fixedPoints: 100 },
      slotHours: [21, 22],
      matchSlots: [{ slotHour: 22, status: "matched" }],
      teams: [
        { id: 1, name: "KMU", roleId: "400000000000000001" },
        { id: 2, name: "UT", roleId: "400000000000000002" },
      ],
      handups: [{ id: 1, slotHour: 21, teamId: 1, teamName: "KMU", raisedBy: ids.alice, createdAt: jst("2026-10-07T15:00:00") }],
      teamStats: [
        { teamId: 1, name: "KMU", activeHandups: [21], matches: 2, excluded: 1, wins: 1, total: 80 },
        { teamId: 2, name: "UT", activeHandups: [], matches: 3, excluded: 0, wins: 4, total: 310 },
      ],
      rounds: [
        { slotDate: "2026-10-06", slotHour: 21, createdAt: 0, pairs: [{ a: "KMU", b: "UT" }], excluded: "NGT" },
        { slotDate: "2026-10-06", slotHour: 22, createdAt: 0, pairs: [], excluded: "UT" },
      ],
      wins: [
        { id: 2, teamName: "UT", match: { a: "KMU", b: "UT" }, slotDate: "2026-10-06", slotHour: 21, points: 30, countedPoints: 100, matchNumber: 6, active: true, recordedBy: ids.admin, createdAt: 0, hasScreenshot: true },
        { id: 1, teamName: "KMU", match: { a: "KMU", b: "NGT" }, slotDate: "2026-10-05", slotHour: 21, points: 80, countedPoints: null, matchNumber: null, active: false, recordedBy: ids.admin, createdAt: 0, hasScreenshot: false },
      ],
      jobs: [],
      schedule: [],
      dashboard: { links: [], sessions: 0 },
      screenshots: 1,
    },
    snapshotError: null,
    ...over,
  } as MockStateData;
}
