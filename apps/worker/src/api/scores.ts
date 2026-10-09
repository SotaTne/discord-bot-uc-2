import { winActiveInputSchema, winPointsInputSchema } from "@uc/api";
import { calculateScores, matchNumbers, resolveRecentSlotDate, winRecordability } from "@uc/core";
import {
  findMatchForTeam,
  findSlotHour,
  findTeamById,
  findWin,
  countMatchesByTeam,
  getGuildSettings,
  hasActiveWin,
  listGuildMatches,
  listMatchedSlots,
  listSlotHours,
  listTeams,
  listWins,
  setWinActive,
  updateWinPoints,
} from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { clearScores } from "../usecases/clear-scores";
import { loadScores, pointsForWin } from "../usecases/scores";
import { teamNames } from "../usecases/team-names";
import { nameOrId, userNames } from "../usecases/user-names";
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, describeWin, addWin } from "../usecases/add-win";
import { parseId, type ApiDeps, type ApiEnv } from "./types";

/** 得点・勝利の記録（有効 / 無効・クリア）・画像・試合ごとの記録の確認 */
export function createScoreRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>()
    // チームごとの得点（N 試合を超えた試合で勝ったときは、一律の固定点で集計した結果）と、その内訳
    .get("/scores", async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const [{ settings, scores, matchCounts }, teams] = await Promise.all([loadScores(db, guildId), listTeams(db, guildId)]);
      const names = await teamNames(createRestFromEnv(c.env), guildId, teams);

      return c.json({
        rule: { fixedAfterMatches: settings.fixedAfterMatches, fixedPoints: settings.fixedPoints },
        teams: teams
          .map((team) => {
            const score = scores.get(team.id);
            return {
              teamId: team.id,
              name: names.get(team.id) ?? team.roleId,
              total: score?.total ?? 0,
              // 試合数: 対戦した組分けの数（勝ち負けに関係なく）。勝利数は、wins の件数。固定点は、試合数で決まる
              matches: matchCounts.get(team.id) ?? 0,
              wins: score?.wins ?? [],
            };
          })
          .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
      });
    })

    // チームごとの、全組分け（古い順）と、その結果。勝利・敗北（相手の勝利）・未記録（有効な勝利がない）。チームの行を押したときの詳細に使う
    .get("/teams/:id/history", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");

      const team = await findTeamById(db, guildId, id);
      if (!team) return c.json({ error: "not_found" as const }, 404);

      const [{ settings, scores }, matches, wins, teams] = await Promise.all([
        loadScores(db, guildId),
        listGuildMatches(db, guildId),
        listWins(db, guildId),
        listTeams(db, guildId, { includeDeleted: true }),
      ]);
      const nameOf = await teamNames(createRestFromEnv(c.env), guildId, teams);
      const numbers = matchNumbers(matches);
      const name = (teamId: number) => nameOf.get(teamId) ?? String(teamId);

      return c.json({
        team: { id, name: name(id) },
        rule: { fixedAfterMatches: settings.fixedAfterMatches, fixedPoints: settings.fixedPoints },
        matches: matches
          .filter((match) => match.teamAId === id || match.teamBId === id)
          .map((match) => {
            const opponentId = match.teamAId === id ? match.teamBId : match.teamAId;
            const ofMatch = wins.filter((win) => win.matchId === match.id);
            const active = ofMatch.find((win) => win.active);
            return {
              matchId: match.id,
              slotDate: match.slotDate,
              slotHour: match.slotHour,
              opponent: { id: opponentId, name: name(opponentId) },
              // そのチームの、何試合目か（1 始まり）
              matchNumber: numbers.get(`${id}#${match.id}`) ?? 0,
              result: !active ? ("none" as const) : active.teamId === id ? ("win" as const) : ("loss" as const),
              // 有効な勝利（勝ったのは、そのチームか、相手）。points は記録した点数、countedPoints は集計に使われる点数
              win: active
                ? {
                    id: active.id,
                    winner: { id: active.teamId, name: name(active.teamId) },
                    points: active.points,
                    countedPoints: scores.get(active.teamId)?.wins.find((win) => win.id === active.id)?.points ?? active.points,
                    hasScreenshot: active.screenshotKey !== null,
                  }
                : null,
              deletedWins: ofMatch.length - (active ? 1 : 0),
            };
          }),
      });
    })

    // 勝利の記録の履歴（新しい順）。無効なものは、active が false
    // 勝利が未記録の組分け（勝利を追加できる状態: マッチング済み + 試合の開始時刻を過ぎている。削除済みの試合時刻は含めない）。古い順。
    // ダッシュボードの「勝利記録」の印（件数）と一覧に使う。有効な勝利がなければ未記録（削除した勝利だけがあるものも、未記録）
    .get("/unrecorded-matches", async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const now = deps.clock.now();
      const [matchedSlots, wins, slots, teams, guildMatches] = await Promise.all([
        listMatchedSlots(db, { guildId }),
        listWins(db, guildId),
        listSlotHours(db, guildId),
        listTeams(db, guildId, { includeDeleted: true }),
        listGuildMatches(db, guildId),
      ]);
      const liveHours = new Set(slots.map((slot) => slot.hour));
      const recorded = new Set(wins.filter((win) => win.active).map((win) => win.matchId));
      const deletedWins = new Map<number, number>();
      for (const win of wins) if (!win.active) deletedWins.set(win.matchId, (deletedWins.get(win.matchId) ?? 0) + 1);
      const numbers = matchNumbers(guildMatches);
      const nameOf = await teamNames(createRestFromEnv(c.env), guildId, teams);
      const team = (id: number) => ({ id, name: nameOf.get(id) ?? String(id) });

      return c.json({
        matches: matchedSlots
          .filter((slot) => liveHours.has(slot.slotHour) && winRecordability({ matched: true, slotDate: slot.slotDate, slotHour: slot.slotHour, now }) === "ok")
          .flatMap((slot) =>
            slot.pairs
              .filter((pair) => !recorded.has(pair.matchId))
              .map((pair) => ({
                id: pair.matchId,
                slotDate: slot.slotDate,
                slotHour: slot.slotHour,
                teamA: team(pair.teamAId),
                teamB: team(pair.teamBId),
                matchNumberA: numbers.get(`${pair.teamAId}#${pair.matchId}`) ?? 0,
                matchNumberB: numbers.get(`${pair.teamBId}#${pair.matchId}`) ?? 0,
                deletedWins: deletedWins.get(pair.matchId) ?? 0,
              })),
          ),
      });
    })

    .get("/wins", async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const [rows, teams] = await Promise.all([listWins(db, guildId), listTeams(db, guildId, { includeDeleted: true })]);
      const rest = createRestFromEnv(c.env);
      const nameOf = await teamNames(rest, guildId, teams);
      const people = await userNames(rest, guildId, rows.map((row) => row.recordedBy));

      return c.json({
        wins: [...rows].reverse().map((row) => ({
          id: row.id,
          teamId: row.teamId,
          teamName: nameOf.get(row.teamId) ?? String(row.teamId),
          // 組分け（試合）。対戦枠（日付 × 時刻）だけでは、同じ対戦枠の別の組分けと区別できない
          match: {
            id: row.matchId,
            teamA: nameOf.get(row.teamAId) ?? String(row.teamAId),
            teamB: nameOf.get(row.teamBId) ?? String(row.teamBId),
          },
          slotDate: row.slotDate,
          slotHour: row.slotHour,
          points: row.points,
          active: row.active,
          recordedBy: row.recordedBy,
          recordedByName: nameOrId(people, row.recordedBy) ?? row.recordedBy,
          createdAt: row.createdAt,
          hasScreenshot: row.screenshotKey !== null,
        })),
      });
    })

    // 記録を、有効にする / 無効にする（間違えた記録を、削除せずに外す。あとで戻せる）
    .put("/wins/:id/active", zValidator("json", winActiveInputSchema), async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);
      const { guildId } = c.get("auth");
      const db = createDb(c.env.DB);
      const { active } = c.req.valid("json");

      const win = await findWin(db, guildId, id);
      if (!win) return c.json({ error: "not_found" as const }, 404);
      // 有効な記録は、1つの組分けに1件まで。ほかに有効な記録があるときは、有効に戻せない（先に、そちらを削除する）
      if (active && !win.active && (await hasActiveWin(db, win.matchId))) return c.json({ error: "win_exists" as const }, 409);

      await setWinActive(db, { guildId, id, active });
      return c.json({ ok: true as const });
    })

    // 記録の点数を編集する（無効な記録も編集できる）。勝ったチーム・組分けは、変えない。得点は、毎回導き直すので、すぐ反映される
    .put("/wins/:id/points", zValidator("json", winPointsInputSchema), async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);

      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const win = await findWin(db, guildId, id);
      if (!win) return c.json({ error: "not_found" as const }, 404);
      // N 試合を超えた試合は、入力が何点でも、固定点で登録する
      const points = await pointsForWin(db, guildId, { teamId: win.teamId, matchId: win.matchId, points: c.req.valid("json").points });
      await updateWinPoints(db, { guildId, id, points });
      return c.json({ ok: true as const, points });
    })

    // 得点のクリア: すべての勝利の記録を削除する（履歴も 0 になる。画像も消す）
    .delete("/wins", async (c) => {
      const { screenshots } = await clearScores({ db: createDb(c.env.DB), bucket: c.env.SCREENSHOTS }, c.get("auth").guildId);
      return c.json({ ok: true as const, screenshots });
    })

    // 記録した画像。管理者のセッションがあるときだけ見られる（R2 のキーは外に出さない）
    .get("/screenshots/:id", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);

      const event = await findWin(createDb(c.env.DB), c.get("auth").guildId, id);
      if (!event?.screenshotKey) return c.json({ error: "not_found" as const }, 404);

      const object = await c.env.SCREENSHOTS.get(event.screenshotKey);
      if (!object) return c.json({ error: "not_found" as const }, 404);

      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
          "Cache-Control": "private, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        },
      });
    });
}
