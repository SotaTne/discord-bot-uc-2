/** 組分け（何試合目かを数えるのに必要な項目だけ） */
export type NumberedMatch = { id: number; slotDate: string; slotHour: number; teamAId: number; teamBId: number };

/** `matchNumbers` の結果のキー。そのチームの、その組分け */
export const matchNumberKey = (teamId: number, matchId: number): string => `${teamId}#${matchId}`;

/**
 * チームごとの「その組分けは、何試合目か」（1 から）。
 * そのチームが入った組分けを、対戦枠の日付・時刻・ID の順に並べた順番。勝ち負けには関係しない。
 * 保存せず、組分けから、毎回、数える（組分けを足したり削除したりすれば、番号も、数え直される）。
 */
export function matchNumbers(matches: readonly NumberedMatch[]): Map<string, number> {
  const ordered = [...matches].sort(
    (a, b) => a.slotDate.localeCompare(b.slotDate) || a.slotHour - b.slotHour || a.id - b.id,
  );
  const counts = new Map<number, number>();
  const result = new Map<string, number>();
  for (const match of ordered) {
    for (const teamId of [match.teamAId, match.teamBId]) {
      const next = (counts.get(teamId) ?? 0) + 1;
      counts.set(teamId, next);
      result.set(matchNumberKey(teamId, match.id), next);
    }
  }
  return result;
}
