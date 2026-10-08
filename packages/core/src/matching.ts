export type HandupEntry = {
  /** 挙手の ID。createdAt が同じときの順序決めに使う */
  id: number;
  teamId: string;
  /** 挙手した時刻（epoch ミリ秒） */
  createdAt: number;
};

export type MatchingResult =
  | { kind: "insufficient" }
  | {
      kind: "matched";
      /** 挙手が早い順に、2チームずつ */
      pairs: [teamId: string, teamId: string][];
      /** 奇数のときに除外された、最後に挙手したチーム */
      excluded: string | null;
    };

/**
 * 挙手が早い順に並べ、隣同士を組む。奇数なら最後に挙手したチームを除外する。
 * 渡す挙手は、取り消されていない（有効な）ものだけにすること。
 */
export function pairTeams(handups: readonly HandupEntry[]): MatchingResult {
  if (handups.length < 2) {
    return { kind: "insufficient" };
  }

  const ordered = [...handups].sort(
    (a, b) => a.createdAt - b.createdAt || a.id - b.id,
  );

  const excluded = ordered.length % 2 === 1 ? (ordered.pop()?.teamId ?? null) : null;

  const pairs: [string, string][] = [];
  for (let i = 0; i < ordered.length; i += 2) {
    const first = ordered[i];
    const second = ordered[i + 1];
    if (first && second) {
      pairs.push([first.teamId, second.teamId]);
    }
  }

  return { kind: "matched", pairs, excluded };
}
