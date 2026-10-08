import { winActiveInputSchema, winPointsInputSchema } from "@uc/api";
import { calculateScores, resolveRecentSlotDate } from "@uc/core";
import {
  findMatchForTeam,
  findSlot,
  findTeamById,
  findWin,
  countMatchesByTeam,
  getGuildSettings,
  hasActiveWin,
  listTeams,
  listWins,
  setWinActive,
  updateWinPoints,
} from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { toCoreWins } from "../scoring/events";
import { clearScores } from "../usecases/clear-scores";
import { loadScores } from "../usecases/scores";
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
            const score = scores.get(String(team.id));
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

    // 勝利の記録の履歴（新しい順）。無効なものは、active が false
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

      const updated = await updateWinPoints(createDb(c.env.DB), { guildId: c.get("auth").guildId, id, points: c.req.valid("json").points });
      return updated ? c.json({ ok: true as const }) : c.json({ error: "not_found" as const }, 404);
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
