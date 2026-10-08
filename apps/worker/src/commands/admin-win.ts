import { resolveRecentSlotDate } from "@uc/core";
import { findMatchForTeam, findSlot, hasActiveWin, findTeamById, findTeamsByRoleIds, type Team } from "@uc/db";
import { MAX_POINTS, dateSchema } from "@uc/api";
import { deferEphemeral, ephemeralMessage, getIntegerOption, getStringOption } from "@uc/discord";
import { ADMIN_ONLY_MESSAGE, isAdmin } from "./admin";
import { editDeferredResponse } from "./deferred";
import { teamMention } from "./caller";
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, describeWin, addWin, type WinReport } from "../usecases/add-win";
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
  if (!(await findSlot(db, guildId, hour))) {
    return ephemeralMessage(`${hour}時の試合時刻は登録されていません`);
  }

  // 勝利は、マッチングで組まれた試合に紐づく。その対戦枠に、そのチームの試合がなければ、記録できない
  const match = await findMatchForTeam(db, { guildId, slotDate, slotHour: hour, teamId: team.id });
  if (!match) {
    return ephemeralMessage(
      `${slotDate} ${hour}時に、${teamMention(team)} の試合はありません（マッチングされていないか、対戦していません）`,
    );
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
    return ephemeralMessage("画像（PNG・JPEG・WebP・GIF）を指定してください");
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
    console.error("勝利の記録に失敗しました", error);
    content = "勝利の記録に失敗しました。もう一度お試しください";
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

function winMessage(input: WinInput, report: WinReport): string {
  const lines = [
    // 対戦枠（日付 × 時刻）だけでは、同じ対戦枠の別の組分けと区別できないので、組分け（誰と誰か）も出す
    `${teamMention(input.team)} ${input.slotDate} ${input.slotHour}時（${input.opponent ? `${teamMention(input.team)} vs ${teamMention(input.opponent)}` : "組分け"}）の勝利を追加しました（${report.countedPoints ?? input.points}pt）`,
  ];
  if (report.matchNumber !== null) {
    lines.push(
      report.fixed
        ? `- ${report.matchNumber}試合目: ${report.fixedAfterMatches}試合を超えているので、集計は一律${report.fixedPoints}ptになります`
        : `- ${report.matchNumber}試合目: 集計は${report.countedPoints}ptです`,
    );
  }
  return lines.join("\n");
}
