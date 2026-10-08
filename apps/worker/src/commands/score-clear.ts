import { confirmMessage, ephemeralMessage, updateMessage } from "@uc/discord";
import { ADMIN_ONLY_MESSAGE, isAdmin } from "./admin";
import { clearScores } from "../usecases/clear-scores";
import type { CommandHandler } from "./registry";

const PREFIX = "score-clear";
const CONFIRM_ID = `${PREFIX}:confirm`;
const CANCEL_ID = `${PREFIX}:cancel`;

/**
 * /uc-admin-score-clear: すべてのチームの得点と履歴を削除する（管理者のみ）。
 * 取り返しがつきにくい操作なので、まず確認のボタンを出す。
 */
export const scoreClear: CommandHandler = async ({ interaction }) => {
  if (!isAdmin(interaction)) return ephemeralMessage(ADMIN_ONLY_MESSAGE);
  if (!interaction.guild_id) return ephemeralMessage("サーバー内で実行してください");

  return confirmMessage({
    content: [
      "すべてのチームの得点と、勝利の履歴（画像を含む）、組分け（試合数）を削除します。",
      "削除すると、1試合目からやり直しになり、元に戻せません。",
    ].join("\n"),
    confirmId: CONFIRM_ID,
    confirmLabel: "クリアする",
    cancelId: CANCEL_ID,
  });
};

/** 確認のボタンが押されたとき。押した人の権限も、あらためて確認する */
export const scoreClearComponent: CommandHandler = async ({ interaction, db, env }) => {
  if (!isAdmin(interaction)) return ephemeralMessage(ADMIN_ONLY_MESSAGE);
  const guildId = interaction.guild_id;
  if (!guildId) return ephemeralMessage("サーバー内で実行してください");

  const customId = interaction.data?.custom_id ?? "";
  if (customId === CANCEL_ID) return updateMessage("キャンセルしました");
  if (customId !== CONFIRM_ID) return ephemeralMessage("この操作は無効です");

  await clearScores({ db, bucket: env.SCREENSHOTS }, guildId);
  return updateMessage("すべてのチームの得点と、勝利の履歴・組分けを削除しました");
};
