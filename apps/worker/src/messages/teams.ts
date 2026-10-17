import type { Team } from "@uc/db";
import { teamMention } from "./mention";

/** チームと、そのチームの試合数（そのチームが入った組分けの数） */
export type TeamCountRow = { team: Team; count: number; limit?: number | null; over?: boolean };

/** 行の末尾の印: 超過していれば「規定数を超えています」。ちょうど規定数なら、次の試合で超えることを知らせる */
const mark = ({ count, limit, over }: { count: number; limit: number | null; over?: boolean | undefined }): string => {
  if (over) return "　規定数を超えています";
  return limit !== null && count === limit ? "　次の試合で規定数を超えます" : "";
};

/** /uc-teams の文面: チームごとの、これまでの試合数と、次が何試合目か（純粋な関数） */
export function formatTeamCounts(rows: readonly TeamCountRow[]): string {
  if (rows.length === 0) return "チームが登録されていません";
  const limit = rows[0]?.limit ?? null;
  const header = limit === null ? "チームごとの試合数" : `チームごとの試合数（規定数: ${limit}試合）`;
  return [
    header,
    ...rows.map(({ team, count, limit: rowLimit, over }) => `${teamMention(team)}  ${count}試合（次は ${count + 1}試合目）${mark({ count, limit: rowLimit ?? null, over })}`),
  ].join("\n");
}
