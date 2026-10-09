import { dateQuerySchema, matchInputSchema, matchSlotInputSchema, matchSlotReopenInputSchema, matchWinFormSchema } from "@uc/api";
import { cutoffJobKey, jstDateOf, matchNumbers, slotHoursOnDate, slotPhase } from "@uc/core";
import {
  addMatch,
  claimJob,
  findMatchSlot,
  releaseJob,
  reopenMatchSlot,
  ensureHandup,
  deleteMatch,
  findMatch,
  findSlot,
  findTeamById,
  getGuildSettings,
  listHandupsOnDate,
  listMatchesOnDate,
  listGuildMatches,
  listMatchSlots,
  listSlots,
  listTeams,
  listWins,
  MatchTeamTakenError,
} from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { deleteScreenshots } from "../usecases/clear-scores";
import { matchingCancelledMessage } from "../scheduled/messages";
import { confirmMatching } from "../usecases/confirm-matching";
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, WinExistsError, describeWin, addWin } from "../usecases/add-win";
import { teamNames } from "../usecases/team-names";
import { nameOrId, userNames } from "../usecases/user-names";
import { parseId, type ApiDeps, type ApiEnv } from "./types";

/**
 * 対戦枠の画面（日付ごとの、対戦枠 → 挙手・組分け・勝利）のための API。
 * 挙手・マッチング・勝利が、対戦枠を中心に、1つの画面で扱えるようにする。
 */
export function createBoardRoutes(deps: ApiDeps) {
  return new Hono<ApiEnv>()
    // その日の、対戦枠ごとの状態: 受付の段階・挙手したチーム・組分け・組分けごとの勝利（有効な記録）・組まれなかったチーム
    .get("/board", zValidator("query", dateQuerySchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const now = deps.clock.now();
      const date = c.req.valid("query").date ?? jstDateOf(now);

      const [settings, slots, teams, matchSlots, handups, matches, allWins, guildMatches] = await Promise.all([
        getGuildSettings(db, guildId),
        listSlots(db, guildId, { includeDeleted: true }),
        listTeams(db, guildId, { includeDeleted: true }),
        listMatchSlots(db, { guildId, slotDate: date }),
        listHandupsOnDate(db, { guildId, slotDate: date }),
        listMatchesOnDate(db, { guildId, slotDate: date }),
        listWins(db, guildId),
        listGuildMatches(db, guildId),
      ]);
      // チームごとの「その組分けは、何試合目か」。N 試合を超える試合は、勝つと、固定点で登録される（画面の入力の案内に使う）
      const numbers = matchNumbers(guildMatches);
      const wins = allWins.filter((win) => win.slotDate === date);

      // 削除した試合時刻は、削除した日までの対戦枠を、出す（deleted: true）。記録の有無には、よらない
      const boardHours = slotHoursOnDate(slots, date);

      const rest = createRestFromEnv(c.env);
      const nameOf = await teamNames(rest, guildId, teams);
      const people = await userNames(rest, guildId, [...handups.map((h) => h.raisedBy), ...wins.map((w) => w.recordedBy)]);
      const team = (id: number) => ({ id, name: nameOf.get(id) ?? String(id) });

      return c.json({
        date,
        today: jstDateOf(now),
        rule: { fixedAfterMatches: settings.fixedAfterMatches, fixedPoints: settings.fixedPoints },
        slots: boardHours.map((slot) => {
          const matchSlot = matchSlots.find((m) => m.slotHour === slot.hour);
          return {
            hour: slot.hour,
            deleted: slot.deleted,
            phase: slotPhase(now, date, slot.hour, settings),
            matched: matchSlot?.status === "matched",
            excluded: matchSlot?.excludedTeamId == null ? null : team(matchSlot.excludedTeamId),
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
              .map((match) => {
                const ofMatch = wins.filter((win) => win.matchId === match.id);
                const active = ofMatch.find((win) => win.active);
                return {
                  id: match.id,
                  teamA: team(match.teamAId),
                  teamB: team(match.teamBId),
                  /** 各チームの、その組分けは何試合目か */
                  matchNumberA: numbers.get(`${match.teamAId}#${match.id}`) ?? 0,
                  matchNumberB: numbers.get(`${match.teamBId}#${match.id}`) ?? 0,
                  // 有効な勝利の記録（1つの組分けに、1件まで）。削除した記録は、ここには出さない
                  win: active
                    ? {
                        id: active.id,
                        team: team(active.teamId),
                        points: active.points,
                        recordedByName: nameOrId(people, active.recordedBy) ?? active.recordedBy,
                        createdAt: active.createdAt,
                        hasScreenshot: active.screenshotKey !== null,
                      }
                    : null,
                  deletedWins: ofMatch.length - (active ? 1 : 0),
                };
              }),
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
      const slotDate = input.slotDate ?? jstDateOf(now);
      // 登録した試合時刻のほか、削除した試合時刻でも、画面に出ている対戦枠（削除した日まで）には、追加できる
      const onDate = slotHoursOnDate(await listSlots(db, guildId, { includeDeleted: true }), slotDate);
      if (!onDate.some((slot) => slot.hour === input.slotHour)) return c.json({ error: "slot_not_found" as const }, 404);
      try {
        const id = await addMatch(db, { guildId, slotDate, slotHour: input.slotHour, teamAId: input.teamAId, teamBId: input.teamBId, createdAt: now.getTime() });
        for (const teamId of [input.teamAId, input.teamBId]) {
          await ensureHandup(db, { guildId, slotDate, slotHour: input.slotHour, teamId, raisedBy: userId, createdAt: now.getTime() });
        }
        return c.json({ id }, 201);
      } catch (error) {
        if (error instanceof MatchTeamTakenError) return c.json({ error: "team_already_matched" as const }, 409);
        throw error;
      }
    })

    // 組分けを削除する。その組分けの勝利の記録（無効なものも）と、画像も、あわせて削除する
    .delete("/matches/:id", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);

      const deleted = await deleteMatch(createDb(c.env.DB), { guildId: c.get("auth").guildId, id });
      if (!deleted) return c.json({ error: "not_found" as const }, 404);
      await deleteScreenshots(c.env.SCREENSHOTS, deleted.screenshotKeys);
      return c.json({ ok: true as const });
    })

    // 管理者が、対戦枠のマッチングを、いま確定する（cron の締切と同じ処理）。挙手を組み、結果を Discord に投稿する。
    // cron と同じ「実行する権利」を取るので、締切の時刻になっても、二重には実行されない
    .post("/match-slots/confirm", zValidator("json", matchSlotInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const input = c.req.valid("json");
      const now = deps.clock.now();
      const slotDate = input.slotDate ?? jstDateOf(now);

      if (!(await findSlot(db, guildId, input.slotHour))) return c.json({ error: "slot_not_found" as const }, 404);
      if ((await findMatchSlot(db, { guildId, slotDate, slotHour: input.slotHour }))?.status === "matched") {
        return c.json({ error: "slot_matched" as const }, 409);
      }
      const key = cutoffJobKey(slotDate, input.slotHour);
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

    // マッチング済みの対戦枠を、未マッチングに戻す。その対戦枠の組分けと勝利（無効なものも）と画像を削除する。挙手は残る
    .post("/match-slots/reopen", zValidator("json", matchSlotReopenInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const input = c.req.valid("json");
      const now = deps.clock.now();
      const slotDate = input.slotDate ?? jstDateOf(now);
      // 削除した試合時刻の対戦枠は、やり直せない（組分けと勝利の削除も、Discord への投稿もしない）
      if (!(await findSlot(db, guildId, input.slotHour))) return c.json({ error: "slot_not_found" as const }, 404);

      // キャンセルの投稿に使うので、消す前の、組分けと、組まれなかったチームを、控えておく
      const before = {
        slot: await findMatchSlot(db, { guildId, slotDate, slotHour: input.slotHour }),
        matches: (await listMatchesOnDate(db, { guildId, slotDate })).filter((match) => match.slotHour === input.slotHour),
      };

      const reopened = await reopenMatchSlot(db, { guildId, slotDate, slotHour: input.slotHour });
      if (!reopened) return c.json({ error: "slot_not_matched" as const }, 409);
      await deleteScreenshots(c.env.SCREENSHOTS, reopened.screenshotKeys);

      // 締切の時刻の前なら、cron が、あらためて自動で確定できるように、権利を返す。過ぎていれば、管理者が確定するまで、そのまま
      const settings = await getGuildSettings(db, guildId);
      if (slotPhase(now, slotDate, input.slotHour, settings) !== "closed") {
        await releaseJob(db, guildId, cutoffJobKey(slotDate, input.slotHour));
      }

      // 投稿済みの組分けが、取り消されたことを、Discord に知らせる（組分けの個別の編集では、知らせない）。
      // 投稿に失敗しても、やり直しは、取り消さない（notified: false で、画面に知らせる）
      const excludedTeamId = before.slot?.excludedTeamId ?? null;
      const announced = before.matches.length > 0 || excludedTeamId !== null;
      let notified = false;
      let notifyFailed = false;
      if ((input.notify ?? true) && announced && settings.channelId) {
        try {
          const teams = await listTeams(db, guildId, { includeDeleted: true });
          await createRestFromEnv(c.env).createMessage(settings.channelId, {
            content: matchingCancelledMessage({
              hour: input.slotHour,
              pairs: before.matches.map((match): [number, number] => [match.teamAId, match.teamBId]),
              excluded: excludedTeamId,
              teamById: new Map(teams.map((team) => [team.id, team])),
            }),
            allowed_mentions: { parse: ["roles"] },
          });
          notified = true;
        } catch (error) {
          console.error("マッチングのキャンセルの投稿に失敗しました", error);
          notifyFailed = true;
        }
      }
      return c.json({ ok: true as const, deletedMatches: reopened.deletedMatches, deletedWins: reopened.deletedWins, notified, notifyFailed });
    })

    // 組分けに、勝利を追加する（画像つきの multipart/form-data）。有効な記録は、1つの組分けに1件まで
    .post("/matches/:id/wins", async (c) => {
      const id = parseId(c.req.param("id"));
      if (id === null) return c.json({ error: "invalid_id" as const }, 400);
      const db = createDb(c.env.DB);
      const { guildId, userId } = c.get("auth");

      const match = await findMatch(db, { guildId, id });
      if (!match) return c.json({ error: "not_found" as const }, 404);

      const form = await c.req.parseBody();
      const parsed = matchWinFormSchema.safeParse({ teamId: form.teamId, points: form.points });
      if (!parsed.success) return c.json({ error: "invalid_input" as const }, 400);
      if (parsed.data.teamId !== match.teamAId && parsed.data.teamId !== match.teamBId) {
        return c.json({ error: "team_not_in_match" as const }, 400);
      }

      const image = form.image;
      if (!(image instanceof File)) return c.json({ error: "image_required" as const }, 400);
      if (!(image.type in IMAGE_EXTENSIONS)) return c.json({ error: "unsupported_image" as const }, 400);
      if (image.size > MAX_IMAGE_BYTES) return c.json({ error: "image_too_large" as const }, 400);

      const team = await findTeamById(db, guildId, parsed.data.teamId);
      if (!team) return c.json({ error: "team_not_found" as const }, 404);

      try {
        const { id: winId, points } = await addWin(
          { db, bucket: c.env.SCREENSHOTS, now: deps.clock.now().getTime() },
          {
            guildId,
            userId,
            team,
            matchId: match.id,
            points: parsed.data.points,
            image: { bytes: await image.arrayBuffer(), contentType: image.type },
          },
        );
        const report = await describeWin(db, { guildId, teamId: team.id, id: winId });
        return c.json({ id: winId, points, slotDate: match.slotDate, ...report }, 201);
      } catch (error) {
        if (error instanceof WinExistsError) return c.json({ error: "win_exists" as const }, 409);
        throw error;
      }
    });
}
