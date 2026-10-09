import { resolveRecentSlotDate, winRecordability } from "@uc/core";
import { findMatchForTeam, findMatchSlot, findSlotHour, hasActiveWin, findTeamById, findTeamsByRoleIds, type Team } from "@uc/db";
import { MAX_POINTS, dateSchema } from "@uc/api";
import { deferEphemeral, ephemeralMessage, getIntegerOption, getStringOption } from "@uc/discord";
import { ADMIN_ONLY_MESSAGE, isAdmin } from "./admin";
import { editDeferredResponse } from "./deferred";
import { winMessage } from "../messages/win";
import { teamMention } from "../messages/mention";
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, UnsupportedImageError, describeWin, addWin, type WinReport } from "../usecases/add-win";
import type { CommandContext, CommandHandler } from "./registry";

type WinInput = {
  guildId: string;
  userId: string;
  team: Team;
  slotDate: string;
  slotHour: number;
  /** 勝った試合（その対戦枠で、そのチームが出る組分け） */
  matchId: number;
  /** 組分けの相手のチーム（結果の文面に、組分けを出すため） */
  opponent: Team | null;
  points: number;
  attachment: { url: string; contentType: string };
};

/**
 * /uc-admin-win time team-role point image [date]: 勝利を追加する（管理者のみ）。
 * 画像の取得と保存に時間がかかるので、まず「考え中」を返して、結果はあとで返信を編集して伝える。
 */
export const adminWin: CommandHandler = async (context) => {
  const { interaction, db, clock } = context;
  if (!isAdmin(interaction)) return ephemeralMessage(ADMIN_ONLY_MESSAGE);

  const guildId = interaction.guild_id;
  const userId = interaction.member?.user.id;
  if (!guildId || !userId) return ephemeralMessage("サーバー内で実行してください");

  const hour = getIntegerOption(interaction, "time");
  const points = getIntegerOption(interaction, "point");
  const roleId = getStringOption(interaction, "team-role");
  const attachmentId = getStringOption(interaction, "image");
  const dateText = getStringOption(interaction, "date");
  if (hour === null || points === null || !roleId || !attachmentId) {
    return ephemeralMessage("必須のオプションが指定されていません");
  }
  if (points < 0 || points > MAX_POINTS) return ephemeralMessage(`点数は0〜${MAX_POINTS}で指定してください`);

  if (dateText !== null && !dateSchema.safeParse(dateText).success) {
    return ephemeralMessage("日付は YYYY-MM-DD の形式で、実在する日付を指定してください");
  }
  // 日付を省略したときは、今より前で一番直近の、その時刻の対戦枠
  const slotDate = dateText ?? resolveRecentSlotDate(clock.now(), hour);

  const [team] = await findTeamsByRoleIds(db, guildId, [roleId]);
  if (!team) return ephemeralMessage("チームとして登録されていないロールです");
  if (!(await findSlotHour(db, guildId, hour))) {
    return ephemeralMessage(`${hour}時の試合時刻は登録されていません`);
  }

  // 勝利は、マッチングで組まれた試合に紐づく。その対戦枠に、そのチームの試合がなければ、記録できない
  const match = await findMatchForTeam(db, { guildId, slotDate, slotHour: hour, teamId: team.id });
  if (!match) {
    return ephemeralMessage(
      `${slotDate} ${hour}時に、${teamMention(team)} の試合はありません（マッチングされていないか、対戦していません）`,
    );
  }

  // このコマンドで記録できるのは、マッチング済みで、試合の開始時刻を過ぎた組分けだけ（日付の打ち間違いなどを止める）。
  // ダッシュボードからなら、いつでも記録できる
  const recordability = winRecordability({
    matched: (await findMatchSlot(db, { guildId, slotDate, slotHour: hour }))?.status === "matched",
    slotDate,
    slotHour: hour,
    now: clock.now(),
  });
  if (recordability === "not-matched") {
    return ephemeralMessage(`${slotDate} ${hour}時は、まだマッチング処理が済んでいません。済んでから実行するか、ダッシュボードから記録してください`);
  }
  if (recordability === "not-started") {
    return ephemeralMessage(`${slotDate} ${hour}時の試合は、まだ始まっていません。始まってから実行するか、ダッシュボードから記録してください`);
  }

  // 有効な記録は、1つの組分けに1件まで。間違えたときは、ダッシュボードで削除してから、記録し直す
  if (await hasActiveWin(db, match.matchId)) {
    return ephemeralMessage("その組分けには、すでに勝利が記録されています。ダッシュボードの「対戦枠」で削除してから、記録し直してください");
  }

  const opponentId = match.teamAId === team.id ? match.teamBId : match.teamAId;
  const opponent = (await findTeamById(db, guildId, opponentId, { includeDeleted: true })) ?? null;

  const attachment = interaction.data?.resolved?.attachments?.[attachmentId];
  if (!attachment) return ephemeralMessage("画像が見つかりません");
  const contentType = attachment.content_type?.split(";")[0]?.trim() ?? "";
  if (!(contentType in IMAGE_EXTENSIONS)) {
    return ephemeralMessage("画像（PNG・JPEG・WebP）を指定してください");
  }
  if (attachment.size > MAX_IMAGE_BYTES) return ephemeralMessage("画像は8MB以下にしてください");

  context.waitUntil(
    finishWin(context, { guildId, userId, team, slotDate, slotHour: hour, matchId: match.matchId, opponent, points, attachment: { url: attachment.url, contentType } }),
  );
  return deferEphemeral();
};

async function finishWin(context: CommandContext, input: WinInput) {
  let content: string;
  try {
    content = await saveAndSummarize(context, input);
  } catch (error) {
    if (error instanceof UnsupportedImageError) {
      // 拡張子は画像でも、中身が違う（壊れたファイル、別の形式の名前を変えたもの）
      content = "画像（PNG・JPEG・WebP）ではありません。画像のファイルを指定してください";
    } else {
      console.error("勝利の記録に失敗しました", error);
      content = "勝利の記録に失敗しました。もう一度お試しください";
    }
  }
  try {
    await editDeferredResponse(context, content);
  } catch (error) {
    console.error("結果の返信に失敗しました", error);
  }
}

async function saveAndSummarize(context: CommandContext, input: WinInput): Promise<string> {
  const { db, env, clock } = context;

  const response = await context.fetch(input.attachment.url);
  if (!response.ok) throw new Error(`画像を取得できませんでした: ${response.status}`);
  const bytes = await response.arrayBuffer();

  const { id } = await addWin(
    { db, bucket: env.SCREENSHOTS, now: clock.now().getTime() },
    { ...input, image: { bytes, contentType: input.attachment.contentType } },
  );
  const report = await describeWin(db, { guildId: input.guildId, teamId: input.team.id, id });
  return winMessage(input, report);
}
