import type { MatchingResult } from "./matching";

/**
 * 対戦履歴を見て、組み合わせを決める（純粋な関数。DB・時計・Discord には、依存しない）。
 * 仕様の図（docs/matting-flow.svg）の流れを、次の点で、まとめている。
 *   - 図の「全組み合わせの補完」は、要らない（履歴にない組み合わせは、「一度も対戦していない」として扱う）
 *   - 履歴は、1 回の走査で集計する（組み合わせごとに、DB を引かない）
 *   - 並べ替えの「ランダム」は、比較のたびに引かず、組み合わせごとに 1 回だけ引く（比較が、いつも同じ答えになる）
 */

/** 組み合わせの対象になる、挙手しているチーム（この対戦枠で、まだ組分けされていないチーム） */
export type PairingTeam<T extends string | number = number> = {
  teamId: T;
  /** 挙手の ID。挙手した時刻が同じときの順序決めに使う */
  handupId: number;
  /** 挙手した時刻（epoch ミリ秒） */
  handupAt: number;
};

/** 過去の組分け。全期間の分を渡す（対象チームが入っていないものは、無視される） */
export type PastMatch<T extends string | number = number> = {
  teamAId: T;
  teamBId: T;
  /** 対戦枠の日付（JST, YYYY-MM-DD）。「当日」の判定に使う */
  slotDate: string;
  /** 対戦枠の開始時刻（epoch ミリ秒）。「最後に対戦した日時」に使う */
  at: number;
};

export type PairingInput<T extends string | number = number> = {
  /** いまの対戦枠の日付。この日の組分けが、「当日の試合数」になる */
  today: string;
  teams: readonly PairingTeam<T>[];
  pastMatches: readonly PastMatch<T>[];
  /** 試合数の規定数（null は、なし）。奇数のとき、これを超えているチームを、先に、除外の候補にする */
  limit: number | null;
  /** 0 以上 1 未満の乱数。組み合わせの順序が、まったく同じときだけ、使う。テストでは、差し替える */
  random: () => number;
};

/** チームごとの、組み合わせに使う数 */
type TeamStat = {
  /** 全期間の試合数（そのチームが入った組分けの数） */
  total: number;
  /** 当日の試合数 */
  today: number;
};

/** 2 チームの、これまでの対戦 */
type PairStat = {
  count: number;
  /** 最後に対戦した対戦枠の開始時刻。一度もなければ、-Infinity（いちばん古い扱い） */
  last: number;
};

/** 挙手の順（早い順）。同じ時刻なら、挙手の ID の順 */
const byHandup = <T extends string | number>(a: PairingTeam<T>, b: PairingTeam<T>) => a.handupAt - b.handupAt || a.handupId - b.handupId;

/**
 * 対象のチームごとに、全期間と当日の試合数を数え、2 チームごとに、対戦回数と最後の対戦を集計する。
 * 過去の組分けを 1 回だけ走査する。キーは、ranked（挙手の順）での、位置。
 */
function summarize<T extends string | number>(ranked: readonly PairingTeam<T>[], input: Pick<PairingInput<T>, "today" | "pastMatches">) {
  const rankOf = new Map<T, number>(ranked.map((team, index) => [team.teamId, index]));
  const teamStats: TeamStat[] = ranked.map(() => ({ total: 0, today: 0 }));
  const pairStats = new Map<number, PairStat>();
  const n = ranked.length;

  for (const match of input.pastMatches) {
    const a = rankOf.get(match.teamAId);
    const b = rankOf.get(match.teamBId);
    for (const rank of [a, b]) {
      if (rank === undefined) continue;
      const stat = teamStats[rank]!;
      stat.total += 1;
      if (match.slotDate === input.today) stat.today += 1;
    }
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? a * n + b : b * n + a;
    const stat = pairStats.get(key) ?? { count: 0, last: -Infinity };
    stat.count += 1;
    if (match.at > stat.last) stat.last = match.at;
    pairStats.set(key, stat);
  }
  return { teamStats, pairStats };
}

/**
 * 奇数のとき、除外するチームの位置（ranked の何番目か）を決める。乱数は、使わない。
 *   1. 規定数を超えているチーム（全期間の試合数 > 規定数）がいれば、そのチームだけを、候補にする。いなければ、全員
 *   2. 候補のうち、当日の試合数が、いちばん多いチームだけに、絞る（当日、すでに多く対戦したチームを、休ませる）
 *   3. その中で、挙手が、いちばん遅いチームを、除外する
 */
function chooseExcludedRank(teamStats: readonly TeamStat[], limit: number | null): number {
  const all = teamStats.map((_, rank) => rank);
  const over = limit === null ? [] : all.filter((rank) => teamStats[rank]!.total > limit);
  const candidates = over.length > 0 ? over : all;

  const mostToday = Math.max(...candidates.map((rank) => teamStats[rank]!.today));
  const busiest = candidates.filter((rank) => teamStats[rank]!.today === mostToday);

  // ranked は、挙手の早い順。いちばん遅いのは、位置が、いちばん後ろのもの
  return Math.max(...busiest);
}

/**
 * 挙手しているチームを、対戦履歴を見て、2 チームずつに組む。
 *   - 奇数なら、先に 1 チームを除外する（`chooseExcludedRank` の規則）
 *   - 残りの全組み合わせを、次の順で並べ、前から順に、両チームが、まだ組まれていなければ、採用する
 *       1. 最後に対戦した日時が、古い方（一度も対戦していなければ、いちばん古い）
 *       2. 過去の対戦回数が、少ない方
 *       3. 同じなら、乱数（組み合わせごとに 1 回だけ引く）。乱数も同じなら、挙手の順
 *   - 2 チーム未満なら、成立しない（insufficient）
 * 結果の並びは、読みやすいよう、組分けの中は挙手の早い順、組分け全体は、先頭のチームの挙手の早い順にそろえる。
 * 渡す挙手は、取り消されていない（有効な）ものだけにすること。同じチームが複数あれば、挙手の早い方だけを使う。
 */
export function pairByHistory<T extends string | number = number>(input: PairingInput<T>): MatchingResult<T> {
  const seen = new Set<T>();
  const ranked = [...input.teams].sort(byHandup).filter((team) => (seen.has(team.teamId) ? false : (seen.add(team.teamId), true)));
  if (ranked.length < 2) return { kind: "insufficient" };

  const { teamStats, pairStats } = summarize(ranked, input);
  const n = ranked.length;

  // 奇数なら、除外するチームを決める。残りのチームは、ranked の位置のまま扱う
  const excludedRank = n % 2 === 1 ? chooseExcludedRank(teamStats, input.limit) : null;
  const remaining = ranked.map((_, rank) => rank).filter((rank) => rank !== excludedRank);

  // 全組み合わせ。乱数は、組み合わせごとに 1 回だけ、決まった順（挙手の順）で引く
  const candidates: { a: number; b: number; count: number; last: number; tiebreak: number }[] = [];
  for (let i = 0; i < remaining.length; i++) {
    for (let j = i + 1; j < remaining.length; j++) {
      const a = remaining[i]!;
      const b = remaining[j]!;
      const stat = pairStats.get(a * n + b);
      candidates.push({ a, b, count: stat?.count ?? 0, last: stat?.last ?? -Infinity, tiebreak: input.random() });
    }
  }
  candidates.sort((x, y) => cmp(x.last, y.last) || x.count - y.count || x.tiebreak - y.tiebreak || x.a - y.a || x.b - y.b);

  // 前から順に、両チームが、まだ組まれていなければ、採用する
  const used = new Set<number>();
  const chosen: [number, number][] = [];
  for (const { a, b } of candidates) {
    if (chosen.length * 2 === remaining.length) break;
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    chosen.push([a, b]);
  }

  chosen.sort((x, y) => x[0] - y[0]);
  return {
    kind: "matched",
    pairs: chosen.map(([a, b]) => [ranked[a]!.teamId, ranked[b]!.teamId]),
    excluded: excludedRank === null ? null : ranked[excludedRank]!.teamId,
  };
}

/** 数の比較（-Infinity どうしも、0 にする） */
const cmp = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);
