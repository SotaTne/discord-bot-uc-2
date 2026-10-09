import type { DevClock } from "@uc/api";
import type { Clock } from "@uc/core";

/**
 * 開発専用の疑似時計。worker が、状態を持つ（開発用のサーバーが動いている間だけ）。
 * 「本物の時刻 + ずれ（offsetMs）」。時間は、そのまま進む。
 * 本番のビルドには入らない（`import.meta.env.DEV` の中だけで使う）。
 */
export type DevClockState = DevClock;

let state: DevClockState = { offsetMs: 0 };

export const getDevClockState = (): DevClockState => state;

export function setDevClockState(next: DevClockState): void {
  state = next;
}

/** 疑似時計（base が、本物の時計） */
export function devClock(base: Clock): Clock {
  return { now: () => new Date(base.now().getTime() + state.offsetMs) };
}

/** 外から来た値を、疑似時計の状態にする。形が正しくなければ null */
export function parseDevClockState(input: unknown): DevClockState | null {
  if (typeof input !== "object" || input === null) return null;
  const { offsetMs } = input as { offsetMs?: unknown };
  return typeof offsetMs === "number" && Number.isFinite(offsetMs) ? { offsetMs } : null;
}
