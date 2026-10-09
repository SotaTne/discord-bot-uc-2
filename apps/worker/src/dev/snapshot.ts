import type { DevSnapshot } from "@uc/api";
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
  listWins,
  listSlots,
  listTeams,
  type Db,
} from "@uc/db";
import type { DiscordRest } from "@uc/discord";
import { loadScores } from "../usecases/scores";
import { teamNames } from "../usecases/team-names";

const MAX_ROUNDS = 30;
const MAX_WINS = 50;

/**
 * 開発専用: worker の「いまの状態」を、まとめて返す（疑似 Discord の画面が、常に状態を見せるため）。
 * 挙手・対戦・勝利・得点・cron の予定と履歴・照合・ログインの状況を含む。
 */
export async function buildDevSnapshot(input: {
  db: Db;
  guildId: string;
  /** 疑似時計があれば、その時刻。募集・締切の予定や「今日」は、これで決める */
  clock: Clock;
  /** ログインの有効期限の判定に使う、本物の時計（認証は、疑似時計の影響を受けない） */
  baseClock: Clock;
  /** チームの表示名（ロールの名前）を取るための、Discord REST */
  rest: Pick<DiscordRest, "getGuildRoles">;
}): Promise<DevSnapshot> {
  const { db, guildId } = input;
  const now = input.clock.now();
  const today = jstDateOf(now);

  const [settings, slots, teams, matchSlotsToday, handupsToday, rounds, scoreRows, jobRuns, jobKeys, links, sessions] =
    await Promise.all([
      getGuildSettings(db, guildId),
      listSlots(db, guildId),
      listTeams(db, guildId, { includeDeleted: true }),
      listMatchSlots(db, { guildId, slotDate: today }),
      listHandupsOnDate(db, { guildId, slotDate: today }),
      listMatchedSlots(db, { guildId }),
      listWins(db, guildId),
      listJobRuns(db, guildId, 30),
      listJobKeys(db, guildId),
      listDashboardLinks(db, guildId, 20),
      listActiveSessions(db, guildId, input.baseClock.now().getTime()),
    ]);

  const nameOf = await teamNames(input.rest, guildId, teams);
  const name = (id: number) => nameOf.get(id) ?? String(id);

  // 得点: 有効な勝利が、そのチームの何試合目で、集計は何 pt か
  const { scores, matchCounts } = await loadScores(db, guildId);
  const counted = new Map<number, { matchNumber: number; points: number }>();
  for (const score of scores.values()) {
    for (const win of score.wins) counted.set(win.id, { matchNumber: win.matchNumber, points: win.points });
  }

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
    today,
    settings: {
      channelId: settings.channelId,
      recruitHour: settings.recruitHour,
      cutoffMinutes: settings.cutoffMinutes,
      fixedAfterMatches: settings.fixedAfterMatches,
      fixedPoints: settings.fixedPoints,
    },
    slots: slots.map((slot) => slot.hour),
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
      const score = scores.get(team.id);
      return {
        teamId: team.id,
        name: name(team.id),
        activeHandups: handupsToday
          .filter((handup) => handup.teamId === team.id)
          .map((handup) => handup.slotHour),
        // 試合数: 対戦した組分けの数（管理者が追加した、マッチング前の組分けも含む）
        matches: matchCounts.get(team.id) ?? 0,
        // 奇数のために除外された回数（挙手が1チームだけで、組めなかった対戦枠は、数えない）
        excluded: rounds.filter((round) => round.excludedTeamId === team.id && round.pairs.length > 0).length,
        wins: score?.wins.length ?? 0,
        total: score?.total ?? 0,
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
    wins: [...scoreRows]
      .reverse()
      .slice(0, MAX_WINS)
      .map((row) => ({
        id: row.id,
        teamName: name(row.teamId),
        /** 組分け（試合）の2チーム */
        match: { a: name(row.teamAId), b: name(row.teamBId) },
        slotDate: row.slotDate,
        slotHour: row.slotHour,
        points: row.points,
        countedPoints: counted.get(row.id)?.points ?? null,
        matchNumber: counted.get(row.id)?.matchNumber ?? null,
        active: row.active,
        recordedBy: row.recordedBy,
        createdAt: row.createdAt,
        hasScreenshot: row.screenshotKey !== null,
      })),
    jobs: jobRuns.map((job) => ({ key: job.jobKey, createdAt: job.createdAt })),
    schedule,
    dashboard: { links, sessions: sessions.length },
    screenshots: scoreRows.filter((row) => row.screenshotKey !== null).length,
  };
}
