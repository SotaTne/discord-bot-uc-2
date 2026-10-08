import type { DevSnapshot } from "@uc/api";
import type { InteractionResponse } from "@uc/discord";
import { generateDevKeyPair } from "@uc/discord/testing";
import { createMockApp } from "./app";
import { createInteractionClient, type TickSummary } from "./interaction-client";
import { defaultSeed } from "./seed";
import { createMockState } from "./state";

export const jst = (text: string) => Date.parse(`${text}+09:00`);

/** 動作確認ページが見せる、worker の状態のサンプル（20:53。21時の締切が、いま実行できる） */
export function makeSnapshot(over: Partial<DevSnapshot> = {}): DevSnapshot {
  const alice = "500000000000000001";
  const carol = "500000000000000003";
  const admin = "500000000000000005";
  return {
    now: new Date(jst("2026-10-07T20:53:00")).toISOString(),
    today: "2026-10-07",
    settings: { channelId: "300000000000000001", recruitHour: 12, cutoffMinutes: 7, fixedAfterMatches: 5, fixedPoints: 100 },
    slots: [21, 22, 23],
    matchSlots: [
      { slotHour: 21, status: "open" },
      { slotHour: 22, status: "matched" },
    ],
    teams: [
      { id: 1, name: "KMU", roleId: "400000000000000001" },
      { id: 2, name: "UT", roleId: "400000000000000002" },
    ],
    handups: [
      { id: 1, slotHour: 21, teamId: 1, teamName: "KMU", raisedBy: alice, createdAt: jst("2026-10-07T15:00:00") },
    ],
    teamStats: [
      { teamId: 1, name: "KMU", activeHandups: [21], matches: 2, excluded: 1, wins: 1, total: 80 },
      { teamId: 2, name: "UT", activeHandups: [], matches: 3, excluded: 0, wins: 4, total: 310 },
    ],
    rounds: [
      { slotDate: "2026-10-06", slotHour: 21, createdAt: jst("2026-10-06T20:53:00"), pairs: [{ a: "KMU", b: "UT" }], excluded: "NGT" },
      { slotDate: "2026-10-06", slotHour: 22, createdAt: jst("2026-10-06T21:53:00"), pairs: [], excluded: "UT" },
    ],
    wins: [
      { id: 2, teamName: "UT", match: { a: "KMU", b: "UT" }, slotDate: "2026-10-06", slotHour: 21, points: 30, countedPoints: 100, matchNumber: 6, active: true, recordedBy: admin, createdAt: jst("2026-10-07T10:00:00"), hasScreenshot: true },
      { id: 1, teamName: "KMU", match: { a: "KMU", b: "NGT" }, slotDate: "2026-10-05", slotHour: 21, points: 80, countedPoints: null, matchNumber: null, active: false, recordedBy: admin, createdAt: jst("2026-10-06T10:00:00"), hasScreenshot: false },
    ],
    jobs: [{ key: "recruit:2026-10-07", createdAt: jst("2026-10-07T12:00:00") }],
    schedule: [
      { key: "recruit:2026-10-07", label: "12:00 募集開始の投稿", from: new Date(jst("2026-10-07T12:00:00")).toISOString(), until: new Date(jst("2026-10-07T13:00:00")).toISOString(), state: "done" },
      { key: "cutoff:2026-10-07:21", label: "21時の試合の締切（7分前）: マッチングの確定と投稿", from: new Date(jst("2026-10-07T20:53:00")).toISOString(), until: new Date(jst("2026-10-07T21:30:00")).toISOString(), state: "ready" },
      { key: "cutoff:2026-10-07:22", label: "22時の試合の締切（7分前）: マッチングの確定と投稿", from: new Date(jst("2026-10-07T21:53:00")).toISOString(), until: new Date(jst("2026-10-07T22:30:00")).toISOString(), state: "waiting" },
    ],
    dashboard: { links: [{ issuedBy: admin, createdAt: jst("2026-10-07T16:00:00"), expiresAt: jst("2026-10-07T17:00:00"), usedAt: jst("2026-10-07T16:01:00") }], sessions: 1 },
    screenshots: 1,
    ...over,
  };
}

export type WorkerCall = { method: string; path: string; search: string; headers: Record<string, string>; body: string };

/** worker の代わり。受け取った呼び出しを記録して、決めた応答を返す */
export function createFakeWorker(options: {
  snapshot?: DevSnapshot | (() => DevSnapshot);
  /** /dev/state の HTTP ステータス（200 以外なら、状態を取れない） */
  stateStatus?: number;
  interaction?: InteractionResponse | ((body: string) => InteractionResponse);
  /** /interactions の HTTP ステータス（200 以外なら、署名の検証に失敗したときなど） */
  interactionStatus?: number;
  tick?: TickSummary;
  tickStatus?: number;
  resetStatus?: number;
  screenshot?: { status: number; contentType?: string; bytes?: number[] };
} = {}) {
  const calls: WorkerCall[] = [];
  const snapshot = options.snapshot ?? makeSnapshot();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, search: url.search, headers, body: String(init?.body ?? "") });

    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

    if (url.pathname === "/interactions") {
      if ((options.interactionStatus ?? 200) !== 200) return json({ error: "invalid request signature" }, options.interactionStatus);
      const response = options.interaction ?? { type: 4, data: { content: "ok", flags: 64 } };
      return json(typeof response === "function" ? response(String(init?.body)) : response);
    }
    if (url.pathname === "/dev/state") {
      if ((options.stateStatus ?? 200) !== 200) return json({ error: "x" }, options.stateStatus);
      return json(typeof snapshot === "function" ? snapshot() : snapshot);
    }
    if (url.pathname === "/dev/tick") return json(options.tick ?? { ran: [], errors: [] }, options.tickStatus ?? 200);
    if (url.pathname === "/dev/reset") return json({ ok: true }, options.resetStatus ?? 200);
    if (url.pathname.startsWith("/dev/screenshots/")) {
      const shot = options.screenshot ?? { status: 404 };
      return new Response(shot.status === 200 ? new Uint8Array(shot.bytes ?? [1, 2, 3]) : "not found", {
        status: shot.status,
        headers: shot.contentType ? { "Content-Type": shot.contentType } : {},
      });
    }
    return json({ error: "unexpected" }, 500);
  };

  return { calls, fetchImpl, callsTo: (path: string) => calls.filter((call) => call.path === path) };
}

/** 動作確認ページのアプリを、worker の代わりをつないで作る */
export async function createTestMock(options: Parameters<typeof createFakeWorker>[0] = {}) {
  const keys = await generateDevKeyPair();
  const state = createMockState(defaultSeed());
  const worker = createFakeWorker(options);
  const interactions = createInteractionClient(
    { workerUrl: "http://worker.local", mockUrl: "http://mock.local", keys, applicationId: "100000000000000001", fetch: worker.fetchImpl },
    state,
  );
  const app = createMockApp({ state, interactions, publicKeyHex: keys.publicKeyHex, workerUrl: "http://worker.local" });
  return { app, state, worker, keys, interactions };
}
