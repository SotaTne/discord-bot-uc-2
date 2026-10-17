import { dateQuerySchema, matchInputSchema, matchSlotInputSchema, matchSlotReopenInputSchema } from "@uc/api";
import { cutoffJobKey, hostTeamOf, isContinuedRecruit, jstDateOf, matchNumberKey, matchNumbers, seasonAccess, slotHoursOnDate, slotPhase } from "@uc/core";
import {
  claimJob,
  deleteMatch,
  findMatch,
  findMatchSlot,
  findSlotHour,
  findTeamById,
  getGuildSettings,
  listGuildMatches,
  listHandupsOnDate,
  listMatchesOnDate,
  listMatchSlots,
  listSlotHours,
  listTeams,
  MatchTeamTakenError,
  releaseJob,
} from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { addMatchByAdmin, reopenSlotByAdmin } from "../usecases/admin-matches";
import { seasonAccessFor, seasonWindow } from "../usecases/season";
import { confirmMatching } from "../usecases/confirm-matching";
import { cancelWaiting } from "../usecases/continued-recruit";
import { teamNames } from "../usecases/team-names";
import { nameOrId, userNames } from "../usecases/user-names";
import { parseId, type ApiDeps, type ApiEnv } from "./types";

/**
 * 対戦枠の画面（日付ごとの、対戦枠 → 挙手・組分け）のための API。
 * 挙手とマッチングが、対戦枠を中心に、1つの画面で扱えるようにする。
 */
export function createBoardRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>()
    // その日の、対戦枠ごとの状態: 受付の段階・挙手したチーム・組分け・組まれなかったチーム
    .get("/board", zValidator("query", dateQuerySchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const now = deps.clock.now();
      const today = jstDateOf(now);
      const date = c.req.valid("query").date ?? today;

      const [settings, slots, teams, matchSlots, handups, matches, guildMatches] = await Promise.all([
        getGuildSettings(db, guildId),
        listSlotHours(db, guildId, { includeDeleted: true }),
        listTeams(db, guildId, { includeDeleted: true }),
        listMatchSlots(db, { guildId, slotDate: date }),
        listHandupsOnDate(db, { guildId, slotDate: date }),
        listMatchesOnDate(db, { guildId, slotDate: date }),
        listGuildMatches(db, guildId),
      ]);
      // チームごとの「その組分けは、何試合目か」。そのチームが入った組分けを、日付・時刻の順に数える（保存しない）
      const numbers = matchNumbers(guildMatches);
      // 削除した試合時刻は、削除した日までの対戦枠を、出す（deleted: true）。記録の有無には、よらない
      const boardHours = slotHoursOnDate(slots, date);

      const rest = createRestFromEnv(c.env);
      const nameOf = await teamNames(rest, guildId, teams);
      const people = await userNames(rest, guildId, handups.map((h) => h.raisedBy));
      const team = (id: number) => ({ id, name: nameOf.get(id) ?? String(id) });

      return c.json({
        date,
        today,
        access: seasonAccess(today, date, seasonWindow(settings)),
        seasonStart: settings.seasonStart,
        seasonEnd: settings.seasonEnd,
        slots: boardHours.map((slot) => {
          const matchSlot = matchSlots.find((m) => m.slotHour === slot.hour);
          return {
            hour: slot.hour,
            deleted: slot.deleted,
            phase: slotPhase(now, date, slot.hour, settings),
            matched: matchSlot?.status === "matched",
            excluded: matchSlot?.excludedTeamId == null ? null : team(matchSlot.excludedTeamId),
            // 継続募集中なら、待機しているチーム（組まれなかったチームが待機して、00 分まで、別のチームを募集している）。保存せず、計算する
            waiting:
              matchSlot && matchSlot.excludedTeamId !== null && isContinuedRecruit({ ...matchSlot, slotDate: date, slotHour: slot.hour }, now)
                ? team(matchSlot.excludedTeamId)
                : null,
            handups: handups
              .filter((handup) => handup.slotHour === slot.hour)
              .map((handup) => ({
                id: handup.id,
                team: team(handup.teamId),
                raisedByName: nameOrId(people, handup.raisedBy) ?? handup.raisedBy,
                createdAt: handup.createdAt,
              })),
            matches: matches
              .filter((match) => match.slotHour === slot.hour)
              .map((match) => ({
                id: match.id,
                teamA: team(match.teamAId),
                teamB: team(match.teamBId),
                // 各チームの、その組分けは、何試合目か
                matchNumberA: numbers.get(matchNumberKey(match.teamAId, match.id)) ?? 0,
                matchNumberB: numbers.get(matchNumberKey(match.teamBId, match.id)) ?? 0,
                // その組分けが、規定数を超えた試合か（何試合目 > 規定数。表示だけ）
                overA: settings.matchLimit !== null && (numbers.get(matchNumberKey(match.teamAId, match.id)) ?? 0) > settings.matchLimit,
                overB: settings.matchLimit !== null && (numbers.get(matchNumberKey(match.teamBId, match.id)) ?? 0) > settings.matchLimit,
                // 主催（部屋を立てる側）。組分けを作るときに、無作為に決めて保存した値。古い行（空）だけ、計算で補う
                host: team(match.hostTeamId ?? hostTeamOf({ slotDate: date, slotHour: slot.hour, teamAId: match.teamAId, teamBId: match.teamBId })),
              })),
          };
        }),
      });
    })

    // 管理者が、組分けを追加する。2チームの挙手は、自動で付く（すでにあれば、そのまま）
    .post("/matches", zValidator("json", matchInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId, userId } = c.get("auth");
      const input = c.req.valid("json");
      const now = deps.clock.now();

      for (const teamId of [input.teamAId, input.teamBId]) {
        if (!(await findTeamById(db, guildId, teamId))) return c.json({ error: "team_not_found" as const }, 404);
      }
      const today = jstDateOf(now);
      const slotDate = input.slotDate ?? today;
      if ((await seasonAccessFor(db, guildId, today, slotDate)) !== "play") return c.json({ error: "outside_season" as const }, 409);
      // 登録した試合時刻のほか、削除した試合時刻でも、画面に出ている対戦枠（削除した日まで）には、追加できる
      const onDate = slotHoursOnDate(await listSlotHours(db, guildId, { includeDeleted: true }), slotDate);
      if (!onDate.some((slot) => slot.hour === input.slotHour)) return c.json({ error: "slot_not_found" as const }, 404);
      try {
        const id = await addMatchByAdmin(
          { db, rest: createRestFromEnv(c.env), now },
          { guildId, userId, slotDate, slotHour: input.slotHour, teamAId: input.teamAId, teamBId: input.teamBId },
        );
        return c.json({ id }, 201);
      } catch (error) {
        if (error instanceof MatchTeamTakenError) return c.json({ error: "team_already_matched" as const }, 409);
        throw error;
      }
    })

    // 組分けを削除する
    .delete("/matches/:id", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);

      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const found = await findMatch(db, { guildId, id });
      if (!found) return c.json({ error: "not_found" as const }, 404);
      // 大会が終わったあとも、期間に入っていた日の組分けは、削除できる
      const today = jstDateOf(deps.clock.now());
      if ((await seasonAccessFor(db, guildId, today, found.slotDate)) === "closed") return c.json({ error: "outside_season" as const }, 409);

      const deleted = await deleteMatch(db, { guildId, id });
      if (!deleted) return c.json({ error: "not_found" as const }, 404);
      return c.json({ ok: true as const });
    })

    // 管理者が、対戦枠のマッチングを、いま確定する（cron の締切と同じ処理）。挙手を組み、結果を Discord に投稿する。
    // cron と同じ「実行する権利」を取るので、締切の時刻になっても、二重には実行されない
    .post("/match-slots/confirm", zValidator("json", matchSlotInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const input = c.req.valid("json");
      const now = deps.clock.now();
      const today = jstDateOf(now);
      const slotDate = input.slotDate ?? today;
      if ((await seasonAccessFor(db, guildId, today, slotDate)) !== "play") return c.json({ error: "outside_season" as const }, 409);

      if (!(await findSlotHour(db, guildId, input.slotHour))) return c.json({ error: "slot_not_found" as const }, 404);
      if ((await findMatchSlot(db, { guildId, slotDate, slotHour: input.slotHour }))?.status === "matched") {
        return c.json({ error: "slot_matched" as const }, 409);
      }
      const key = cutoffJobKey(slotDate, input.slotHour);
      // 対戦枠が未マッチングなのに権利が残っているのは、締切を過ぎてから「やり直す」を実行したとき（cron が自動で確定しないように、権利を残してある）。
      // 管理者の確定は、それを承知の操作なので、権利を取り直して実行する
      await releaseJob(db, guildId, key);
      if (!(await claimJob(db, guildId, key, now.getTime()))) return c.json({ error: "slot_matched" as const }, 409);

      try {
        const settings = await getGuildSettings(db, guildId);
        await confirmMatching(
          { db, rest: createRestFromEnv(c.env) },
          { guildId, channelId: settings.channelId, slotDate, slotHour: input.slotHour, now },
        );
        return c.json({ ok: true as const });
      } catch (error) {
        await releaseJob(db, guildId, key);
        throw error;
      }
    })

    // マッチング済みの対戦枠を、未マッチングに戻す。その対戦枠の組分けを削除する。挙手は残る
    .post("/match-slots/reopen", zValidator("json", matchSlotReopenInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const input = c.req.valid("json");
      const now = deps.clock.now();
      const today = jstDateOf(now);
      const slotDate = input.slotDate ?? today;
      // 大会が終わったあとも、期間に入っていた日は、やり直せる。期間の外の日は、できない
      if ((await seasonAccessFor(db, guildId, today, slotDate)) === "closed") return c.json({ error: "outside_season" as const }, 409);
      // 削除した試合時刻の対戦枠は、やり直せない（組分けの削除も、Discord への投稿もしない）
      if (!(await findSlotHour(db, guildId, input.slotHour))) return c.json({ error: "slot_not_found" as const }, 404);

      const reopened = await reopenSlotByAdmin(
        { db, rest: createRestFromEnv(c.env), now },
        { guildId, slotDate, slotHour: input.slotHour, notify: input.notify ?? true },
      );
      if (!reopened) return c.json({ error: "slot_not_matched" as const }, 409);
      return c.json({ ok: true as const, ...reopened });
    })

    // 管理者が、待機（継続募集）を解除する。待機しているチームの代わりに、「待機をキャンセル」を押すのと、同じ。
    // 待機は、チームの選択なので、代わりに「待機する」ことは、できない（解除だけ）
    .post("/match-slots/cancel-waiting", zValidator("json", matchSlotInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const input = c.req.valid("json");
      const now = deps.clock.now();
      const today = jstDateOf(now);
      const slotDate = input.slotDate ?? today;
      if ((await seasonAccessFor(db, guildId, today, slotDate)) !== "play") return c.json({ error: "outside_season" as const }, 409);

      if (!(await findSlotHour(db, guildId, input.slotHour, { includeDeleted: true }))) return c.json({ error: "slot_not_found" as const }, 404);
      const slot = await findMatchSlot(db, { guildId, slotDate, slotHour: input.slotHour });
      if (!slot) return c.json({ error: "not_waiting" as const }, 409);

      // 管理者の操作なので、byTeamId は渡さない（待機しているチームでなくても、解除できる）
      const result = await cancelWaiting(
        { db, rest: createRestFromEnv(c.env), now },
        { guildId, slot, slotDate, slotHour: input.slotHour },
      );
      if (result !== "cancelled") return c.json({ error: "not_waiting" as const }, 409);
      return c.json({ ok: true as const });
    });
}
