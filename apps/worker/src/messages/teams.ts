import type { Team } from "@uc/db";
import { teamMention } from "./mention";

/** チームと、そのチームの試合数（そのチームが入った組分けの数） */
export type TeamCountRow = { team: Team; count: number };

/** /uc-teams の文面: チームごとの、これまでの試合数と、次が何試合目か（純粋な関数） */
export function formatTeamCounts(rows: readonly TeamCountRow[]): string {
  if (rows.length === 0) return "チームが登録されていません";
  return ["チームごとの試合数", ...rows.map(({ team, count }) => `${teamMention(team)}  ${count}試合（次は ${count + 1}試合目）`)].join("\n");
}
