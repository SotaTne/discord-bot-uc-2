import type { Team } from "@uc/db";

/** チームのロールのメンション（`<@&ロールID>`）。Discord が、ロールの名前で見せる。通知が飛ぶかは、投稿のときの allowed_mentions（channel.ts）で決まる */
export const teamMention = (team: Team) => `<@&${team.roleId}>`;
