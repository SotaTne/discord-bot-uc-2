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
