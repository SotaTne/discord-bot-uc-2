import { isJobDue, jstDateOf, scheduledJobsForDate, type Clock, type ScheduledJobSpec } from "@uc/core";
import {
  claimJob,
  deleteExpiredCredentials,
  listConfiguredGuilds,
  listMatchSlots,
  listSlotHours,
  listTeams,
  releaseJob,
  type Db,
  type GuildSettingsValues,
} from "@uc/db";
import type { DiscordRest } from "@uc/discord";
import { confirmMatching } from "../usecases/confirm-matching";
import { postRecruit, recruitMention } from "../messages";

export type ScheduledDeps = {
  db: Db;
  rest: Pick<DiscordRest, "createMessage">;
  clock: Clock;
};

export type ScheduledSummary = {
  /** 今回の実行で、実際に行ったジョブ（例: recruit:2026-10-07:12） */
  ran: string[];
  errors: string[];
};

type GuildConfig = { guildId: string } & GuildSettingsValues;
type Job = { key: string; run: () => Promise<void> };

/**
 * 毎分呼ばれる。募集開始の投稿と、試合の K 分前の締切（マッチングの確定と投稿）を、時刻が来ていれば行う。
 * ジョブは job_runs で「実行する権利」を取ってから行うので、二重に起動されても1回しか実行されない。
 */
export async function runScheduled(deps: ScheduledDeps): Promise<ScheduledSummary> {
  const summary: ScheduledSummary = { ran: [], errors: [] };

  // 毎時0分に、期限切れのログインリンクとセッションを消す（保存を増やし続けない）
  const now = deps.clock.now();
  if (now.getUTCMinutes() === 0) {
    await deleteExpiredCredentials(deps.db, now.getTime()).catch((error) =>
      console.error("期限切れの掃除に失敗しました", error),
    );
  }

  for (const guild of await listConfiguredGuilds(deps.db)) {
    try {
      await runGuild(deps, guild, summary);
    } catch (error) {
      // 1つのサーバーの失敗で、ほかのサーバーを止めない
      console.error(`cron の処理に失敗しました: ${guild.guildId}`, error);
      summary.errors.push(`${guild.guildId}: ${errorText(error)}`);
    }
  }
  return summary;
}

async function runGuild(deps: ScheduledDeps, guild: GuildConfig, summary: ScheduledSummary) {
  const { db, clock } = deps;
  const channelId = guild.channelId;
  if (!channelId) return;

  const now = clock.now();
  const today = jstDateOf(now);

  // 予定（いつ、どのジョブを実行するか）は、画面に出すものと同じ規則（@uc/core）で決める
  const slots = await listSlotHours(db, guild.guildId);
  const specs = scheduledJobsForDate({
    date: today,
    recruitHour: guild.recruitHour,
    cutoffMinutes: guild.cutoffMinutes,
    slotHours: slots.map((slot) => slot.hour),
  });

  await releaseStaleCutoffClaims(deps, guild.guildId, specs, today, now);

  const jobs: Job[] = specs
    .filter((spec) => isJobDue(spec, now))
    .map((spec) => ({
      key: spec.key,
      run:
        spec.kind === "recruit"
          ? async () => {
              await postRecruit(deps.rest, {
                channelId,
                hour: guild.recruitHour,
                mention: recruitMention(guild, guild.recruitMentionMode === "teams" ? await listTeams(db, guild.guildId) : []),
              });
            }
          : () =>
              confirmMatching(deps, {
                guildId: guild.guildId,
                channelId,
                slotDate: today,
                slotHour: spec.slotHour ?? 0,
                now,
              }),
    }));

  for (const job of jobs) {
    if (!(await claimJob(db, guild.guildId, job.key, now.getTime()))) continue;
    try {
      await job.run();
      summary.ran.push(job.key);
    } catch (error) {
      // 失敗したら権利を返す。猶予のあいだは、次の cron でやり直される
      await releaseJob(db, guild.guildId, job.key);
      console.error(`ジョブに失敗しました: ${job.key}`, error);
      summary.errors.push(`${job.key}: ${errorText(error)}`);
    }
  }
}

/**
 * 締切のジョブの「実行済み」の記録のうち、古くなったものを、解除する。
 * 締切を過ぎてから「やり直す」を実行すると、自動で確定し直さないように、記録を残す。そのあとで、締切を後ろにずらす（7 分前 → 5 分前 など）と、
 * 新しい締切は、まだ先なのに、古い記録が残っていて、マッチングが、行われなくなる。
 * そこで、「対戦枠が、マッチング済みではなく、締切の時刻が、まだ来ていない」ジョブの記録は、古いものとして、解除する。
 * 締切を過ぎているときの記録は、解除しない（過ぎてからやり直したものは、管理者が確定するまで、そのまま）
 */
async function releaseStaleCutoffClaims(deps: ScheduledDeps, guildId: string, specs: readonly ScheduledJobSpec[], today: string, now: Date) {
  const waiting = specs.filter((spec) => spec.kind === "cutoff" && now.getTime() < spec.from.getTime());
  if (waiting.length === 0) return;

  const matchedHours = new Set(
    (await listMatchSlots(deps.db, { guildId, slotDate: today })).filter((slot) => slot.status === "matched").map((slot) => slot.slotHour),
  );
  for (const spec of waiting) {
    if (!matchedHours.has(spec.slotHour ?? -1)) await releaseJob(deps.db, guildId, spec.key);
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
