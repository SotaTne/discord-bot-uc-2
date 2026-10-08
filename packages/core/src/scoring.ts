/**
 * 得点は、勝利の記録と、組分け（試合）から、毎回導き直す。
 *
 * ルール:
 * - チームの試合数は、そのチームが入った組分けの数（勝ち負けに関係なく）。試合は、対戦枠の日付・時刻の順に、1 試合目、2 試合目…と数える。
 * - 勝ったときの点数は、N 試合目までは、記録した点数（生点）。N を超えた試合（N+1 試合目から）は、生点に関係なく、固定点。
 * - 負けた試合は、点が入らない（試合数には、数える）。
 *
 * 間違えた記録は、削除せずに「無効」（active = false）にする。無効な記録は、得点に数えない（試合数には、数える。組分けは、残るので）。
 */
export type Win = {
  /** 記録した順に増える番号 */
  id: number;
  /** 勝った試合（組分け） */
  matchId: number;
  /** 勝ったチーム */
  teamId: string;
  /** 入力された生の点数 */
  points: number;
  /** 有効か。false の記録は、数えない */
  active: boolean;
};

/** 組分け（試合）。2チームが、ある日の、ある対戦枠で、対戦する */
export type PlayedMatch = {
  id: number;
  teamIds: [teamId: string, teamId: string];
  /** 対戦枠の日付（JST, YYYY-MM-DD） */
  slotDate: string;
  slotHour: number;
};

export type ScoreRule = {
  /** この試合数目までは、勝つと生点を使う（N+1 試合目から、固定点） */
  fixedAfterMatches: number;
  fixedPoints: number;
};

export const defaultScoreRule: ScoreRule = { fixedAfterMatches: 5, fixedPoints: 100 };

export type ScoredWin = {
  id: number;
  matchId: number;
  slotDate: string;
  slotHour: number;
  rawPoints: number;
  /** 集計に使われる点数（N 試合を超えた試合は、固定点） */
  points: number;
  /** そのチームの、何試合目か（1 始まり） */
  matchNumber: number;
};

export type TeamScore = {
  teamId: string;
  total: number;
  wins: ScoredWin[];
};

/** そのチームの試合を、対戦枠の日付・時刻の順（同じ対戦枠なら ID の順）に並べる */
const byTime = (a: PlayedMatch, b: PlayedMatch) =>
  a.slotDate.localeCompare(b.slotDate) || a.slotHour - b.slotHour || a.id - b.id;

/** チームごとの、「その組分けは、何試合目か」。キーは `${チーム}#${組分け}` */
export function matchNumbers(matches: readonly PlayedMatch[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const byTeam = new Map<string, PlayedMatch[]>();
  for (const match of matches) {
    for (const teamId of match.teamIds) byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), match]);
  }
  for (const [teamId, teamMatches] of byTeam) {
    [...teamMatches].sort(byTime).forEach((match, index) => numbers.set(`${teamId}#${match.id}`, index + 1));
  }
  return numbers;
}

/**
 * 勝利を登録するときの点数。N 試合を超えた試合（matchNumber > N）で勝つと、入力が何点でも、固定点で登録する。
 * （集計の規則と同じ。入力した点数ではなく、規則で整えたあとの点数を、記録に残す）
 */
export function pointsToRegister(input: { points: number; matchNumber: number | null }, rule: ScoreRule): number {
  return input.matchNumber !== null && input.matchNumber > rule.fixedAfterMatches ? rule.fixedPoints : input.points;
}

/** チームごとの得点を返す。有効な勝利を持たないチームは結果に含まれない（呼び出し側は、0 点として扱う）。 */
export function calculateScores(
  wins: readonly Win[],
  matches: readonly PlayedMatch[],
  rule: ScoreRule = defaultScoreRule,
): Map<string, TeamScore> {
  const numbers = matchNumbers(matches);
  const matchById = new Map(matches.map((match) => [match.id, match]));

  const result = new Map<string, TeamScore>();
  for (const win of [...wins].sort((a, b) => a.id - b.id)) {
    if (!win.active) continue;
    const match = matchById.get(win.matchId);
    // 組分けが見つからない記録は、固定点の判定ができないので、生点で数える（記録の整合性は、DB の外部キーが守る）
    const matchNumber = numbers.get(`${win.teamId}#${win.matchId}`) ?? 0;
    const scored: ScoredWin = {
      id: win.id,
      matchId: win.matchId,
      slotDate: match?.slotDate ?? "",
      slotHour: match?.slotHour ?? 0,
      rawPoints: win.points,
      points: matchNumber > rule.fixedAfterMatches ? rule.fixedPoints : win.points,
      matchNumber,
    };

    const score = result.get(win.teamId) ?? { teamId: win.teamId, total: 0, wins: [] };
    score.wins.push(scored);
    score.total += scored.points;
    result.set(win.teamId, score);
  }

  // 勝利は、試合の順に並べる
  for (const score of result.values()) {
    score.wins.sort((a, b) => a.slotDate.localeCompare(b.slotDate) || a.slotHour - b.slotHour || a.id - b.id);
  }
  return result;
}
