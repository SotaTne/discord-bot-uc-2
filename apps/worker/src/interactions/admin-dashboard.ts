import { createDashboardLink, getGuildSettings, revokeAllSessions } from "@uc/db";
import { ephemeralMessage } from "@uc/discord";
import { generateToken, sha256Hex } from "../security/tokens";
import { ADMIN_ONLY_MESSAGE, isAdmin } from "./admin";
import type { CommandHandler } from "./registry";

/** ログインリンクの有効期間（1回しか使えない） */
export const LINK_TTL_MS = 60 * 60 * 1000;

/**
 * /uc-admin-dashboard: ダッシュボードへのログインリンクを発行する（管理者のみ）。
 * トークンはハッシュだけを保存し、リンクは本人にだけ見える返信で渡す。
 * トークンはフラグメント（#）に入れるので、サーバーのログやリファラーに残らない。
 */
export const adminDashboard: CommandHandler = async ({ interaction, db, clock, env, origin }) => {
  if (!isAdmin(interaction)) return ephemeralMessage(ADMIN_ONLY_MESSAGE);
  const guildId = interaction.guild_id;
  const userId = interaction.member?.user.id;
  if (!guildId || !userId) return ephemeralMessage("サーバー内で実行してください");

  // リンクの有効期限は、疑似時計ではなく本物の時刻で決める（ダッシュボード側は本物の時計で確認するため）
  const now = clock.now().getTime();
  const token = generateToken();
  await createDashboardLink(db, {
    tokenHash: await sha256Hex(token),
    guildId,
    issuedBy: userId,
    expiresAt: now + LINK_TTL_MS,
    createdAt: now,
  });

  // 設定によっては、リンクを再発行したときに、古いセッションをすべて失効させる
  const settings = await getGuildSettings(db, guildId);
  const revoked = settings.revokeSessionsOnReissue ? await revokeAllSessions(db, guildId, now) : 0;

  const base = (env.PUBLIC_URL ?? origin).replace(/\/$/, "");
  const lines = [
    "ダッシュボードのリンクです（1回だけ使えて、1時間で無効になります）。他の人には共有しないでください。",
    `${base}/login#token=${token}`,
  ];
  if (revoked > 0) lines.push(`以前のログイン ${revoked} 件は、無効にしました。`);

  return ephemeralMessage(lines.join("\n"), { suppressEmbeds: true });
};
