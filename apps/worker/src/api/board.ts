import { dateQuerySchema, matchInputSchema, matchSlotInputSchema, matchSlotReopenInputSchema } from "@uc/api";
import { cutoffJobKey, hostTeamOf, isContinuedRecruit, jstDateOf, matchNumberKey, matchNumbers, slotHoursOnDate, slotPhase } from "@uc/core";
import {
  addMatch,
  claimJob,
  findMatchSlot,
  releaseJob,
  reopenMatchSlot,
  stopWaiting,
  ensureHandup,
  deleteMatch,
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
} from "@uc/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createDb } from "../db";
import { createRestFromEnv } from "../discord";
import { postMatchingCancelled } from "../messages";
import { deleteWaitingAnnounce } from "../usecases/close-waiting-messages";
import { confirmMatching } from "../usecases/confirm-matching";
import { endContinuedRecruit } from "../usecases/end-waiting";
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
      const date = c.req.valid("query").date ?? jstDateOf(now);

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
        today: jstDateOf(now),
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
      const slotDate = input.slotDate ?? jstDateOf(now);
      // 登録した試合時刻のほか、削除した試合時刻でも、画面に出ている対戦枠（削除した日まで）には、追加できる
      const onDate = slotHoursOnDate(await listSlotHours(db, guildId, { includeDeleted: true }), slotDate);
      if (!onDate.some((slot) => slot.hour === input.slotHour)) return c.json({ error: "slot_not_found" as const }, 404);
      try {
        const id = await addMatch(db, { guildId, slotDate, slotHour: input.slotHour, teamAId: input.teamAId, teamBId: input.teamBId, createdAt: now.getTime() });
        for (const teamId of [input.teamAId, input.teamBId]) {
          await ensureHandup(db, { guildId, slotDate, slotHour: input.slotHour, teamId, raisedBy: userId, createdAt: now.getTime() });
        }
        // フック: 「組分けが追加されたら」、待機中のチームが組まれて、継続募集の相手が決まったなら、継続募集を終わらせる
        // （待機していないチームを組んだときは、継続募集は、そのまま続く）。失敗しても、組分けの追加は、取り消さない
        const slot = await findMatchSlot(db, { guildId, slotDate, slotHour: input.slotHour });
        if (slot && slot.excludedTeamId === null) {
          await endContinuedRecruit(
            { db, rest: createRestFromEnv(c.env) },
            { guildId, slotDate, slotHour: input.slotHour, offerContent: `${input.slotHour}時: 管理者が組分けを決めたため、待機は終わりました。` },
          ).catch((error: unknown) => console.error("継続募集の終了に失敗しました", error));
        }
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

      const deleted = await deleteMatch(createDb(c.env.DB), { guildId: c.get("auth").guildId, id });
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
      const slotDate = input.slotDate ?? jstDateOf(now);

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
      const slotDate = input.slotDate ?? jstDateOf(now);
      // 削除した試合時刻の対戦枠は、やり直せない（組分けの削除も、Discord への投稿もしない）
      if (!(await findSlotHour(db, guildId, input.slotHour))) return c.json({ error: "slot_not_found" as const }, 404);

      // キャンセルの投稿に使うので、消す前の、組分けと、組まれなかったチームを、控えておく
      const before = {
        slot: await findMatchSlot(db, { guildId, slotDate, slotHour: input.slotHour }),
        matches: (await listMatchesOnDate(db, { guildId, slotDate })).filter((match) => match.slotHour === input.slotHour),
      };

      const reopened = await reopenMatchSlot(db, { guildId, slotDate, slotHour: input.slotHour });
      if (!reopened) return c.json({ error: "slot_not_matched" as const }, 409);

      // フック: 「やり直したら」、継続募集を終わらせる（募集のメッセージを削除し、案内のボタンを外す）。失敗しても、やり直しは、取り消さない
      await endContinuedRecruit(
        { db, rest: createRestFromEnv(c.env) },
        { guildId, slotDate, slotHour: input.slotHour, offerContent: `${input.slotHour}時: マッチングがやり直されたため、待機は終わりました。` },
      ).catch((error: unknown) => console.error("継続募集の終了に失敗しました", error));

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
          await postMatchingCancelled(createRestFromEnv(c.env), {
            channelId: settings.channelId,
            hour: input.slotHour,
            pairs: before.matches.map((match): [number, number] => [match.teamAId, match.teamBId]),
            excluded: excludedTeamId,
            teams,
          });
          notified = true;
        } catch (error) {
          console.error("マッチングのキャンセルの投稿に失敗しました", error);
          notifyFailed = true;
        }
      }
      return c.json({ ok: true as const, deletedMatches: reopened.deletedMatches, notified, notifyFailed });
    })

    // 管理者が、待機（継続募集）を解除する。待機しているチームの代わりに、「待機をキャンセル」を押すのと、同じ。
    // 待機は、チームの選択なので、代わりに「待機する」ことは、できない（解除だけ）
    .post("/match-slots/cancel-waiting", zValidator("json", matchSlotInputSchema), async (c) => {
      const db = createDb(c.env.DB);
      const { guildId } = c.get("auth");
      const input = c.req.valid("json");
      const now = deps.clock.now();
      const slotDate = input.slotDate ?? jstDateOf(now);

      if (!(await findSlotHour(db, guildId, input.slotHour, { includeDeleted: true }))) return c.json({ error: "slot_not_found" as const }, 404);
      const slot = await findMatchSlot(db, { guildId, slotDate, slotHour: input.slotHour });
      if (!slot || !isContinuedRecruit({ ...slot, slotDate, slotHour: input.slotHour }, now)) {
        return c.json({ error: "not_waiting" as const }, 409);
      }

      await stopWaiting(db, slot.id);
      // 募集のメッセージを削除する（案内の「待機する」は、残す。チームが、待機し直せる）。失敗しても、解除は、取り消さない
      const { channelId } = await getGuildSettings(db, guildId);
      if (channelId) {
        await deleteWaitingAnnounce({ db, rest: createRestFromEnv(c.env) }, { slot, channelId }).catch((error: unknown) =>
          console.error("募集のメッセージの削除に失敗しました", error),
        );
      }
      return c.json({ ok: true as const });
    });
}
