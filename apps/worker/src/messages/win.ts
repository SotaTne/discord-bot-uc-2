import type { Team } from "@uc/db";
import type { WinReport } from "../usecases/add-win";
import { teamMention } from "./mention";

/** /uc-admin-win の結果の返信（勝利を追加した、のお知らせと、何試合目か・集計の点数） */
export function winMessage(
  input: { team: Team; opponent: Team | null; slotDate: string; slotHour: number; points: number },
  report: WinReport,
): string {  const lines = [
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
