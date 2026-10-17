export type MatchingResult<T extends string | number = number> =
  | { kind: "insufficient" }
  | {
      kind: "matched";
      /** 2チームずつ（組み合わせは、`pairByHistory` が、対戦履歴を見て決める） */
      pairs: [teamId: T, teamId: T][];
      /** 奇数のときに除外されたチーム */
      excluded: T | null;
    };

/**
 * 組分けの主催（マリオカートの部屋を立てる側）を、2 チームのうちから決める。
 * 保存せず、毎回、同じ入力から同じ結果を出す（日付・時刻・2 チームだけで決まる。2 チームの順番には、よらない）。
 * 組分けごとに、ばらけるよう、文字列のハッシュ（FNV-1a）の偶奇で選ぶ。
 */
export function hostTeamOf<T extends string | number>(input: { slotDate: string; slotHour: number; teamAId: T; teamBId: T }): T {
  const [first, second] = [input.teamAId, input.teamBId].sort((a, b) => String(a).localeCompare(String(b), "en", { numeric: true }));
  const key = `${input.slotDate}:${input.slotHour}:${first}:${second}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 2 === 0 ? (first as T) : (second as T);
}
