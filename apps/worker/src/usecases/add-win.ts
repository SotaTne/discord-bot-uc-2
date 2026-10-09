import {
  hasActiveWin,
  insertWin,
  type Db,
  type Team,
} from "@uc/db";
import { loadScores, pointsForWin } from "./scores";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** その組分けには、すでに有効な勝利の記録がある（記録し直すときは、先に、削除する） */
export class WinExistsError extends Error {
  constructor() {
    super("その組分けには、すでに勝利が記録されています");
    this.name = "WinExistsError";
  }
}

export type WinImage = { bytes: ArrayBuffer; contentType: string };

export type RecordWinInput = {
  guildId: string;
  userId: string;
  team: Team;
  /** どの試合の勝利か。チームは、その試合の2チームのどちらか（findMatchForTeam で確かめる） */
  matchId: number;
  points: number;
  image: WinImage;
};

/**
 * 勝利を追加する（コマンドとダッシュボードで共通）。
 * 画像を R2 に保存してから記録し、記録に失敗したら、保存した画像は消す。
 */
export async function addWin(
  deps: { db: Db; bucket: R2Bucket; now: number },
  input: RecordWinInput,
): Promise<{ id: number; screenshotKey: string; points: number }> {
  // 有効な記録は、1つの組分けに1件まで（間違えたときは、削除してから、記録し直す）
  if (await hasActiveWin(deps.db, input.matchId)) throw new WinExistsError();

  const extension = IMAGE_EXTENSIONS[input.image.contentType];
  if (!extension) throw new Error(`画像の形式が対応していません: ${input.image.contentType}`);
  if (input.image.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("画像が大きすぎます");

  const screenshotKey = `screenshots/${input.guildId}/${crypto.randomUUID()}.${extension}`;
  await deps.bucket.put(screenshotKey, input.image.bytes, { httpMetadata: { contentType: input.image.contentType } });

  try {
    // N 試合を超えた試合は、入力が何点でも、固定点で登録する
    const points = await pointsForWin(deps.db, input.guildId, { teamId: input.team.id, matchId: input.matchId, points: input.points });
    const id = await insertWin(deps.db, {
      guildId: input.guildId,
      teamId: input.team.id,
      matchId: input.matchId,
      points,
      screenshotKey,
      recordedBy: input.userId,
      createdAt: deps.now,
    });
    return { id, screenshotKey, points };
  } catch (error) {
    await deps.bucket.delete(screenshotKey);
    throw error;
  }
}

export type WinReport = {
  /** そのチームの何試合目か（1 始まり）。見つからなければ null */
  matchNumber: number | null;
  /** 集計に使われる点数 */
  countedPoints: number | null;
  /** 固定点（N 試合を超えた試合）で集計されるか */
  fixed: boolean;
  fixedAfterMatches: number;
  fixedPoints: number;
};

/** 記録した勝利が、集計でどう扱われるか */
export async function describeWin(
  db: Db,
  input: { guildId: string; teamId: number; id: number },
): Promise<WinReport> {
  const { settings, scores } = await loadScores(db, input.guildId);
  const win = scores.get(input.teamId)?.wins.find((w) => w.id === input.id);

  return {
    matchNumber: win?.matchNumber ?? null,
    countedPoints: win?.points ?? null,
    fixed: win !== undefined && win.matchNumber > settings.fixedAfterMatches,
    fixedAfterMatches: settings.fixedAfterMatches,
    fixedPoints: settings.fixedPoints,
  };
}
