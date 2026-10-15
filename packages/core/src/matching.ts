/** チームの ID の型は、呼ぶ側が決める（既定は、DB と同じ数値）。DB の行は、変換せずに、そのまま渡せる */
export type HandupEntry<T extends string | number = number> = {
  /** 挙手の ID。createdAt が同じときの順序決めに使う */
  id: number;
  teamId: T;
  /** 挙手した時刻（epoch ミリ秒） */
  createdAt: number;
};

export type MatchingResult<T extends string | number = number> =
  | { kind: "insufficient" }
  | {
      kind: "matched";
      /** 挙手が早い順に、2チームずつ */
      pairs: [teamId: T, teamId: T][];
      /** 奇数のときに除外された、最後に挙手したチーム */
      excluded: T | null;
    };

/**
 * 挙手が早い順に並べ、隣同士を組む。奇数なら最後に挙手したチームを除外する。
 * 渡す挙手は、取り消されていない（有効な）ものだけにすること。
 */
export function pairTeams<T extends string | number = number>(handups: readonly HandupEntry<T>[]): MatchingResult<T> {
  if (handups.length < 2) {
    return { kind: "insufficient" };
  }

  const ordered = [...handups].sort(
    (a, b) => a.createdAt - b.createdAt || a.id - b.id,
  );

  const excluded = ordered.length % 2 === 1 ? (ordered.pop()?.teamId ?? null) : null;

  const pairs: [T, T][] = [];
  for (let i = 0; i < ordered.length; i += 2) {
    const first = ordered[i];
    const second = ordered[i + 1];
    if (first && second) {
      pairs.push([first.teamId, second.teamId]);
    }
  }

  return { kind: "matched", pairs, excluded };
}

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
