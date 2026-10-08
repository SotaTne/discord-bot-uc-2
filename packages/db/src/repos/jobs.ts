import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { isUniqueViolation } from "../errors";
import { jobRuns } from "../schema";

/**
 * ジョブを「実行する権利」を取る。同じジョブを先に取った人がいれば false。
 * cron が二重に動いても、投稿やマッチングが重複しないようにするための仕組み。
 */
export async function claimJob(db: Db, guildId: string, jobKey: string, now: number): Promise<boolean> {
  try {
    await db.insert(jobRuns).values({ guildId, jobKey, createdAt: now });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** ジョブが失敗したときに、権利を返す（次の cron でやり直せるようにする） */
export async function releaseJob(db: Db, guildId: string, jobKey: string): Promise<void> {
  await db.delete(jobRuns).where(and(eq(jobRuns.guildId, guildId), eq(jobRuns.jobKey, jobKey)));
}

/** 実行済みのジョブを、新しい順に返す（画面で、cron の履歴を見せるため） */
export function listJobRuns(db: Db, guildId: string, limit = 30) {
  return db
    .select({ jobKey: jobRuns.jobKey, createdAt: jobRuns.createdAt })
    .from(jobRuns)
    .where(eq(jobRuns.guildId, guildId))
    .orderBy(desc(jobRuns.id))
    .limit(limit);
}

/** 実行済みのジョブのキー（今日の予定のうち、どれが済んでいるかを調べるため） */
export async function listJobKeys(db: Db, guildId: string): Promise<Set<string>> {
  const rows = await db.select({ jobKey: jobRuns.jobKey }).from(jobRuns).where(eq(jobRuns.guildId, guildId));
  return new Set(rows.map((row) => row.jobKey));
}
