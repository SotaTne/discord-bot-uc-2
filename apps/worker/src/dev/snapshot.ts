import type { DevSnapshot } from "@uc/api";
import { getDevClockState } from "./clock";
import { jobState, jstDateOf, scheduledJobsForDate, type Clock } from "@uc/core";
import {
  getGuildSettings,
  listActiveSessions,
  listDashboardLinks,
  
  listHandupsOnDate,
  listJobKeys,
  listJobRuns,
  listMatchedSlots,
  listMatchSlots,
  listSlotHours,
  listTeams,
  type Db,
} from "@uc/db";
import type { DiscordRest } from "@uc/discord";
import { teamNames } from "../usecases/team-names";

const MAX_ROUNDS = 30;

/**
 * 開発専用: worker の「いまの状態」を、まとめて返す（疑似 Discord の画面が、常に状態を見せるため）。
 * 挙手・対戦・cron の予定と履歴・照合・ログインの状況を含む。
 */
export async function buildDevSnapshot(input: {
  db: Db;
  guildId: string;
  /** worker の時計（開発では、疑似時計）。募集・締切の予定、「今日」、ログインの有効期限は、これで決める */
  clock: Clock;
  /** チームの表示名（ロールの名前）を取るための、Discord REST */
  rest: Pick<DiscordRest, "getGuildRoles">;
}): Promise<DevSnapshot> {
  const { db, guildId } = input;
  const now = input.clock.now();
  const today = jstDateOf(now);

  const [settings, slots, teams, matchSlotsToday, handupsToday, rounds, jobRuns, jobKeys, links, sessions] =
    await Promise.all([
      getGuildSettings(db, guildId),
      listSlotHours(db, guildId),
      listTeams(db, guildId, { includeDeleted: true }),
      listMatchSlots(db, { guildId, slotDate: today }),
      listHandupsOnDate(db, { guildId, slotDate: today }),
      listMatchedSlots(db, { guildId }),
      listJobRuns(db, guildId, 30),
      listJobKeys(db, guildId),
      listDashboardLinks(db, guildId, 20),
      listActiveSessions(db, guildId, now.getTime()),
    ]);

  const nameOf = await teamNames(input.rest, guildId, teams);
  const name = (id: number) => nameOf.get(id) ?? String(id);

  // 締切のジョブは、対戦枠がマッチング済みなら、済んでいる
  const matchedKeys = new Set(
    matchSlotsToday.filter((slot) => slot.status === "matched").map((slot) => `cutoff:${today}:${slot.slotHour}`),
  );

  const schedule = scheduledJobsForDate({
    date: today,
    recruitHour: settings.recruitHour,
    cutoffMinutes: settings.cutoffMinutes,
    slotHours: slots.map((slot) => slot.hour),
  }).map((job) => ({
    key: job.key,
    label:
      job.kind === "recruit"
        ? `${settings.recruitHour}:00 募集開始の投稿`
        : `${job.slotHour}時の試合の締切（${settings.cutoffMinutes}分前）: マッチングの確定と投稿`,
    from: job.from.toISOString(),
    until: job.until.toISOString(),
    state: jobState(job, now, jobKeys.has(job.key) || matchedKeys.has(job.key)),
  }));

  return {
    now: now.toISOString(),
    clock: getDevClockState(),
    today,
    settings: {
      channelId: settings.channelId,
      recruitHour: settings.recruitHour,
      cutoffMinutes: settings.cutoffMinutes,
    },
    slotHours: slots.map((slot) => slot.hour),
    matchSlots: matchSlotsToday.map((slot) => ({ slotHour: slot.slotHour, status: slot.status })),
    teams: teams.map((team) => ({ id: team.id, name: name(team.id), roleId: team.roleId })),
    handups: handupsToday.map((handup) => ({
      id: handup.id,
      slotHour: handup.slotHour,
      teamId: handup.teamId,
      teamName: name(handup.teamId),
      raisedBy: handup.raisedBy,
      createdAt: handup.createdAt,
    })),
    teamStats: teams.map((team) => {
      return {
        teamId: team.id,
        name: name(team.id),
        activeHandups: handupsToday
          .filter((handup) => handup.teamId === team.id)
          .map((handup) => handup.slotHour),
        // 試合数: マッチング済みの対戦枠で、組まれた組分けの数
        matches: rounds.reduce(
          (count, round) => count + round.pairs.filter((pair) => pair.teamAId === team.id || pair.teamBId === team.id).length,
          0,
        ),
        // 奇数のために除外された回数（挙手が1チームだけで、組めなかった対戦枠は、数えない）
        excluded: rounds.filter((round) => round.excludedTeamId === team.id && round.pairs.length > 0).length,
      };
    }),
    rounds: [...rounds]
      .reverse()
      .slice(0, MAX_ROUNDS)
      .map((round) => ({
        slotDate: round.slotDate,
        slotHour: round.slotHour,
        createdAt: round.matchedAt,
        pairs: round.pairs.map((pair) => ({ a: name(pair.teamAId), b: name(pair.teamBId) })),
        excluded: round.excludedTeamId === null ? null : name(round.excludedTeamId),
      })),
    jobs: jobRuns.map((job) => ({ key: job.jobKey, createdAt: job.createdAt })),
    schedule,
    dashboard: { links, sessions: sessions.length },
  };
}
