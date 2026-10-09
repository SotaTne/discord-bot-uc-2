import { formatJstTime, type HandupPhase } from "@uc/core";
import type { Handup, MatchedSlot, Team } from "@uc/db";
import { teamMention } from "./mention";

const STATUS_PHASE_LABEL: Record<HandupPhase, string> = {
  "before-open": "受付前",
  open: "受付中",
  closed: "締切",
};

/** matched: その日の対戦枠が、マッチング済み（時刻に関係なく、挙手を受け付けない） */
export type SlotStatus = { hour: number; phase: HandupPhase; handups: Handup[]; matched?: boolean };

/** 自チームの挙手状況の文面を作る（純粋な関数） */
export function formatStatus(input: {
  team: Team;
  slotDate: string;
  slots: SlotStatus[];
  /** 自チームの得点（順位・試合数・勝利数）。あれば、見出しの下に出す */
  score?: { total: number; rank: number; matches: number; wins: number; fixedAfterMatches: number; fixedPoints: number };
}): string {
  // 得点は、数字を太字にして、順位・試合数・勝利数を、短く並べる。N を超えたときは、別の行（小さな字）で、その意味を伝える
  const scoreLine = input.score
    ? `\n**${input.score.total}pt**（${input.score.rank}位）・${input.score.matches}試合・${input.score.wins}勝` +
      (input.score.matches > input.score.fixedAfterMatches
        ? `\n-# 試合数${input.score.fixedAfterMatches}を超えました。以降の試合は、勝つと${input.score.fixedPoints}pt固定です`
        : "")
    : "";
  const header = `${teamMention(input.team)} の挙手状況（${input.slotDate}）${scoreLine}`;
  if (input.slots.length === 0) {
    return `${header}\n試合時刻が登録されていません`;
  }

  const lines = input.slots.map(({ hour, phase, handups, matched }) => {
    const active = handups[0];

    const state = active ? `挙手済み（by <@${active.raisedBy}>, ${formatJstTime(new Date(active.createdAt))}）` : "未挙手";
    return `- ${hour}時: ${state}・${matched ? "マッチング済み" : STATUS_PHASE_LABEL[phase]}`;
  });

  return [header, ...lines].join("\n");
}

const ADMIN_PHASE_LABEL: Record<HandupPhase, string> = {
  "before-open": "受付前",
  open: "受付中",
  closed: "締切（マッチング待ち）",
};

export type AdminSlotStatus = {
  hour: number;
  phase: HandupPhase;
  /** 挙手 */
  handups: Handup[];
  /** マッチング済みなら、その結果 */
  matched: MatchedSlot | null;
};

/** 今日の、すべてのチームの挙手状況とマッチング結果の文面を作る（純粋な関数）。チームは、ロールのメンションで表す */
export function formatAdminStatus(input: { slotDate: string; teams: Team[]; slots: AdminSlotStatus[] }): string {
  const header = `# 挙手状況（${input.slotDate}）`;
  if (input.slots.length === 0) return `${header}\n試合時刻が登録されていません`;

  const mention = (teamId: number) => {
    const team = input.teams.find((t) => t.id === teamId);
    return team ? `<@&${team.roleId}>` : `チーム${teamId}`;
  };

  const sections = input.slots.map(({ hour, phase, handups, matched }) => {
    if (matched) {
      const lines = [`## ${hour}時 ・マッチング済み`];
      for (const pair of matched.pairs) lines.push(`- ${mention(pair.teamAId)} vs ${mention(pair.teamBId)}`);
      if (matched.excludedTeamId !== null) lines.push(`- ${mention(matched.excludedTeamId)} は組まれませんでした`);
      if (matched.pairs.length === 0 && matched.excludedTeamId === null) lines.push("挙手がありませんでした");
      return lines.join("\n");
    }

    const lines = [`## ${hour}時 ・${ADMIN_PHASE_LABEL[phase]}`];
    if (handups.length === 0) lines.push("挙手なし");
    for (const handup of handups) {
      lines.push(`- ${mention(handup.teamId)}（by <@${handup.raisedBy}>, ${formatJstTime(new Date(handup.createdAt))}）`);
    }
    return lines.join("\n");
  });

  return [header, ...sections].join("\n");
}
