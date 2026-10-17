import { describe, expect, it } from "vitest";
import { pairByHistory, type PairingInput, type PairingTeam, type PastMatch } from "./pairing";

const DAY = "2026-10-07";
const OTHER_DAY = "2026-10-06";
const at = (day: string, hour: number) => Date.parse(`${day}T00:00:00Z`) + hour * 3_600_000;

/** 挙手: 渡した順に、早く挙手したことにする（時刻は 100 ずつ進む） */
const teams = (...ids: string[]): PairingTeam<string>[] => ids.map((teamId, index) => ({ teamId, handupId: index + 1, handupAt: (index + 1) * 100 }));
/** 過去の組分け */
const played = (a: string, b: string, day = OTHER_DAY, hour = 21): PastMatch<string> => ({ teamAId: a, teamBId: b, slotDate: day, at: at(day, hour) });

/** 乱数は、いつも同じ値（同順位のとき、挙手の順になる） */
const flat = () => 0.5;

const run = (over: Partial<PairingInput<string>> & { teams: PairingTeam<string>[] }) =>
  pairByHistory<string>({ today: DAY, pastMatches: [], limit: null, random: flat, ...over });

/** 決まった種から、同じ列の乱数を作る（mulberry32）。性質のテストで、いろいろな入力を作るのに使う */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("pairByHistory: 成立しない", () => {
  it("挙手が 2 チーム未満なら、成立しない", () => {
    expect(run({ teams: [] })).toEqual({ kind: "insufficient" });
    expect(run({ teams: teams("A") })).toEqual({ kind: "insufficient" });
  });

  it("同じチームの挙手が重なっていても、1 チームとして数える（挙手の早い方を使う）", () => {
    const duplicated = [...teams("A", "B"), { teamId: "A", handupId: 9, handupAt: 9_000 }];

    expect(run({ teams: duplicated })).toEqual({ kind: "matched", pairs: [["A", "B"]], excluded: null });
    expect(run({ teams: [...teams("A"), { teamId: "A", handupId: 9, handupAt: 9_000 }] })).toEqual({ kind: "insufficient" });
  });
});

describe("pairByHistory: 偶数（履歴がないとき）", () => {
  it("履歴も乱数の差もなければ、挙手の早い順に、隣どうしを組む", () => {
    expect(run({ teams: teams("A", "B", "C", "D") })).toEqual({
      kind: "matched",
      pairs: [
        ["A", "B"],
        ["C", "D"],
      ],
      excluded: null,
    });
  });

  it("渡す順に、よらない。挙手の時刻の順で決まる（同じ時刻なら、挙手の ID の順）", () => {
    const shuffled = teams("A", "B", "C", "D").reverse();

    expect(run({ teams: shuffled })).toEqual(run({ teams: teams("A", "B", "C", "D") }));
    const sameTime: PairingTeam<string>[] = [
      { teamId: "B", handupId: 2, handupAt: 100 },
      { teamId: "A", handupId: 1, handupAt: 100 },
    ];
    expect(run({ teams: sameTime })).toEqual({ kind: "matched", pairs: [["A", "B"]], excluded: null });
  });

  it("2 チームだけなら、その 2 チームを組む（履歴に、かかわらず）", () => {
    expect(run({ teams: teams("A", "B"), pastMatches: [played("A", "B"), played("A", "B", "2026-10-05")] })).toEqual({
      kind: "matched",
      pairs: [["A", "B"]],
      excluded: null,
    });
  });
});

describe("pairByHistory: 履歴で、組み合わせを選ぶ", () => {
  it("最近、対戦した相手は、あとにする（直近の対戦が、古い組み合わせを先に）", () => {
    // A-B が最近、A-C・B-D が、その前。A-D・B-C は、一度もない（いちばん先）
    const result = run({
      teams: teams("A", "B", "C", "D"),
      pastMatches: [played("A", "B", "2026-10-06"), played("A", "C", "2026-10-01"), played("B", "D", "2026-10-02")],
    });

    // 一度も対戦していない A-D・B-C が、最優先。同順位なので、挙手の順で、A-D を先に採用する → B-C
    expect(result).toEqual({
      kind: "matched",
      pairs: [
        ["A", "D"],
        ["B", "C"],
      ],
      excluded: null,
    });
  });

  it("全組み合わせが、対戦したことがあるなら、直近の対戦が、古い組み合わせから先に採用する", () => {
    const result = run({
      teams: teams("A", "B", "C", "D"),
      pastMatches: [
        played("A", "B", "2026-10-06"),
        played("C", "D", "2026-10-06"),
        played("A", "C", "2026-10-03"),
        played("B", "D", "2026-10-03"),
        played("A", "D", "2026-10-01"),
        played("B", "C", "2026-10-01"),
      ],
    });

    // いちばん古い A-D・B-C（同じ日。挙手の順で A-D を先に）
    expect(result).toEqual({
      kind: "matched",
      pairs: [
        ["A", "D"],
        ["B", "C"],
      ],
      excluded: null,
    });
  });

  it("最後に対戦した日時が、同じなら、過去の対戦回数が、少ない組み合わせを先にする", () => {
    // A-B と C-D は、どちらも、直近が、同じ日の同じ時刻。A-B は 3 回、C-D は 1 回。A-C・B-D・A-D・B-C は、一度もない
    // → まず、一度もない組み合わせ（A-C など）が先なので、対戦したことがある組み合わせだけで比べるため、2 チームを 2 組に分ける
    const result = run({
      teams: teams("A", "B", "C", "D"),
      pastMatches: [
        played("A", "B", "2026-10-06", 21),
        played("A", "B", "2026-10-05", 21),
        played("A", "B", "2026-10-04", 21),
        played("C", "D", "2026-10-06", 21),
        played("A", "C", "2026-10-06", 21),
        played("B", "D", "2026-10-06", 21),
        played("A", "D", "2026-10-06", 21),
        played("B", "C", "2026-10-06", 21),
      ],
    });

    // 直近は、すべて 10/06 21 時で同じ。回数は、A-B が 3 回、ほかは 1 回。回数の少ない組み合わせが先
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      const flat = result.pairs.map((pair) => pair.join("-"));
      expect(flat).not.toContain("A-B");
      expect(flat).toHaveLength(2);
    }
  });

  it("日付が違うだけでなく、同じ日の、開始時刻の違いも、「古い・新しい」として、比べる", () => {
    const result = run({
      teams: teams("A", "B", "C", "D"),
      pastMatches: [
        played("A", "B", OTHER_DAY, 22), // 新しい
        played("C", "D", OTHER_DAY, 22),
        played("A", "C", OTHER_DAY, 21),
        played("B", "D", OTHER_DAY, 21),
        played("A", "D", OTHER_DAY, 20), // いちばん古い
        played("B", "C", OTHER_DAY, 20),
      ],
    });

    expect(result).toEqual({
      kind: "matched",
      pairs: [
        ["A", "D"],
        ["B", "C"],
      ],
      excluded: null,
    });
  });

  it("一度も対戦していない組み合わせは、対戦したことがある組み合わせより、先に採用する", () => {
    // A-B は対戦済み。C との組み合わせは、すべて、一度もない。A-C を先に採用し、残りの B-D
    const result = run({ teams: teams("A", "B", "C", "D"), pastMatches: [played("A", "B")] });

    expect(result).toEqual({
      kind: "matched",
      pairs: [
        ["A", "C"],
        ["B", "D"],
      ],
      excluded: null,
    });
  });

  it("2 チームの組み合わせは、順番によらない（A-B の履歴は、B-A と同じ）", () => {
    const forward = run({ teams: teams("A", "B", "C", "D"), pastMatches: [played("A", "B")] });
    const backward = run({ teams: teams("A", "B", "C", "D"), pastMatches: [played("B", "A")] });

    expect(backward).toEqual(forward);
  });

  it("対象に入っていないチームの履歴は、無視する。同じチームどうしの履歴も、壊れない", () => {
    const result = run({
      teams: teams("A", "B"),
      pastMatches: [played("A", "Z"), played("Z", "Y"), played("A", "A")],
    });

    expect(result).toEqual({ kind: "matched", pairs: [["A", "B"]], excluded: null });
  });
});

describe("pairByHistory: 乱数（組み合わせの順序が、まったく同じときだけ）", () => {
  it("履歴がなくて、乱数が違えば、乱数の小さい組み合わせが、先になる", () => {
    // 組み合わせの並び（挙手の順）: A-B, A-C, A-D, B-C, B-D, C-D。引く乱数も、この順
    const randoms = [0.9, 0.9, 0.1, 0.1, 0.9, 0.9]; // A-D と B-C が、先
    let index = 0;

    const result = run({ teams: teams("A", "B", "C", "D"), random: () => randoms[index++]! });

    expect(result).toEqual({
      kind: "matched",
      pairs: [
        ["A", "D"],
        ["B", "C"],
      ],
      excluded: null,
    });
    expect(index).toBe(6);
  });

  it("乱数は、組み合わせごとに、ちょうど 1 回だけ引く（比較のたびに、引かない）。n チームなら、n(n-1)/2 回", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      let calls = 0;
      const ids = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));

      run({ teams: teams(...ids), random: () => (calls++, 0.5) });

      // 奇数なら、1 チームを除外してから組む
      const remaining = n % 2 === 1 ? n - 1 : n;
      expect(calls, `n=${n}`).toBe((remaining * (remaining - 1)) / 2);
    }
  });

  it("履歴で順序が決まるなら、乱数は結果を変えない", () => {
    const base = { teams: teams("A", "B", "C", "D"), pastMatches: [played("A", "B", "2026-10-01"), played("C", "D", "2026-10-02"), played("A", "C", "2026-10-03"), played("B", "D", "2026-10-04"), played("A", "D", "2026-10-05"), played("B", "C", "2026-10-06")] };

    const results = [0, 0.3, 0.99].map((value) => run({ ...base, random: () => value }));

    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("同じ乱数の列なら、同じ結果（再現できる）", () => {
    const input = { teams: teams("A", "B", "C", "D", "E", "F"), pastMatches: [played("A", "B")] };

    expect(run({ ...input, random: seeded(42) })).toEqual(run({ ...input, random: seeded(42) }));
  });
});

describe("pairByHistory: 奇数のとき、除外するチーム", () => {
  it("履歴がなければ、いちばん遅く挙手したチームを除外する", () => {
    expect(run({ teams: teams("A", "B", "C") })).toEqual({ kind: "matched", pairs: [["A", "B"]], excluded: "C" });
  });

  it("挙手の時刻が同じなら、挙手の ID が大きい方を、遅いとみなす", () => {
    const sameTime: PairingTeam<string>[] = [
      { teamId: "A", handupId: 1, handupAt: 100 },
      { teamId: "B", handupId: 3, handupAt: 100 },
      { teamId: "C", handupId: 2, handupAt: 100 },
    ];

    expect(run({ teams: sameTime })).toMatchObject({ excluded: "B" });
  });

  it("当日の試合数が、いちばん多いチームを、優先して除外する（挙手が遅くなくても）", () => {
    const result = run({ teams: teams("A", "B", "C"), pastMatches: [played("A", "Z", DAY, 19), played("A", "Y", DAY, 20)] });

    expect(result).toMatchObject({ excluded: "A", pairs: [["B", "C"]] });
  });

  it("当日の試合数が、同じなら、その中で、いちばん遅く挙手したチームを除外する", () => {
    const result = run({ teams: teams("A", "B", "C", "D", "E"), pastMatches: [played("A", "Z", DAY, 19), played("C", "Y", DAY, 19), played("E", "X", DAY, 19)] });

    // A・C・E が、当日 1 試合ずつ。その中で、いちばん遅く挙手した E
    expect(result).toMatchObject({ excluded: "E" });
  });

  it("「当日」は、いまの対戦枠の日付。前の日の試合は、当日の試合数に入れない", () => {
    const result = run({ teams: teams("A", "B", "C"), pastMatches: [played("A", "Z", OTHER_DAY), played("A", "Y", OTHER_DAY)] });

    expect(result).toMatchObject({ excluded: "C" });
  });

  it("規定数を超えているチームがいれば、そのチームだけを、除外の候補にする（挙手が早くても）", () => {
    // 規定数 2。A の全期間の試合数は 3（超えている）。当日は、C が、いちばん多く対戦しているが、候補は A だけ
    const result = run({
      teams: teams("A", "B", "C"),
      limit: 2,
      pastMatches: [played("A", "Z", "2026-09-01"), played("A", "Y", "2026-09-02"), played("A", "X", "2026-09-03"), played("C", "W", DAY, 19), played("C", "V", DAY, 20)],
    });

    expect(result).toMatchObject({ excluded: "A", pairs: [["B", "C"]] });
  });

  it("規定数を超えたチームが、複数なら、その中で、当日の試合数が多い順 → 挙手が遅い順", () => {
    const history = (team: string, count: number, day: string) => Array.from({ length: count }, (_, i) => played(team, `Z${team}${i}`, day, 10 + i));
    const result = run({
      teams: teams("A", "B", "C", "D", "E"),
      limit: 1,
      // A・B は規定数（1）を超えている。D は、ちょうど規定数（超えていない）で、当日、1 試合している。B も、当日、1 試合している
      pastMatches: [...history("A", 2, "2026-09-01"), ...history("B", 2, "2026-09-02"), played("B", "Q", DAY, 18), played("D", "R", DAY, 18)],
    });

    // 候補 = {A, B}（C・D・E は、超えていない）。当日の試合数: A=0、B=1 → B（D は、当日 1 試合だが、候補ではない）
    expect(result).toMatchObject({ excluded: "B" });
  });

  it("ちょうど規定数のチームは、「超えている」に入らない（規定数 < 試合数 のときだけ）", () => {
    const history = Array.from({ length: 2 }, (_, i) => played("A", `Z${i}`, "2026-09-01", 10 + i));

    expect(run({ teams: teams("A", "B", "C"), limit: 2, pastMatches: history })).toMatchObject({ excluded: "C" });
    expect(run({ teams: teams("A", "B", "C"), limit: 1, pastMatches: history })).toMatchObject({ excluded: "A" });
  });

  it("規定数が、なし（null）なら、全員が候補。誰かが、多くの試合をしていても、規定数では、動かない", () => {
    const many = Array.from({ length: 20 }, (_, i) => played("A", `Z${i}`, "2026-09-01", i % 24));

    expect(run({ teams: teams("A", "B", "C"), limit: null, pastMatches: many })).toMatchObject({ excluded: "C" });
  });

  it("除外を決めるのに、乱数は使わない（乱数が違っても、同じ）", () => {
    const input = { teams: teams("A", "B", "C", "D", "E"), pastMatches: [played("B", "Z", DAY), played("D", "Y", DAY)] };

    const excluded = [0, 0.5, 0.99].map((value) => (run({ ...input, random: () => value }) as { excluded: string }).excluded);

    expect(new Set(excluded).size).toBe(1);
  });

  it("除外したチームは、組分けに、入らない。残りのチームで、組み合わせを決める（除外したチームの履歴は、影響しない）", () => {
    // C を除外。A-B は、最近、対戦したが、残りは、A と B だけなので、組む
    const result = run({ teams: teams("A", "B", "C"), pastMatches: [played("A", "B", OTHER_DAY), played("A", "C", "2026-01-01")] });

    expect(result).toEqual({ kind: "matched", pairs: [["A", "B"]], excluded: "C" });
  });

  it("3 チームで、2 チーム未満にならない（1 チーム除外して、1 組）", () => {
    expect(run({ teams: teams("A", "B", "C") })).toMatchObject({ kind: "matched" });
  });
});

describe("pairByHistory: 結果の並び", () => {
  it("組分けの中は、挙手の早い順。組分け全体は、先頭のチームの挙手の早い順", () => {
    // 並びが入れ替わる履歴: A-D, B-C が先に採用される
    const result = run({ teams: teams("A", "B", "C", "D"), pastMatches: [played("A", "B"), played("C", "D"), played("A", "C"), played("B", "D")] });

    expect(result).toEqual({
      kind: "matched",
      pairs: [
        ["A", "D"],
        ["B", "C"],
      ],
      excluded: null,
    });
  });

  it("採用された順が、挙手の順と違っても、結果は、挙手の順にそろえる（後ろのチームの組分けが、先に採用されても）", () => {
    // A-D と B-C が最優先で、乱数で B-C が先に採用される。それでも、結果は、A-D → B-C の順
    const randoms = [0.9, 0.9, 0.9, 0.1, 0.9, 0.9]; // A-B, A-C, A-D, B-C, B-D, C-D の順に引く
    let index = 0;

    const result = run({
      teams: teams("A", "B", "C", "D"),
      pastMatches: [played("A", "B"), played("C", "D"), played("A", "C"), played("B", "D")],
      random: () => randoms[index++]!,
    });

    expect(result).toEqual({
      kind: "matched",
      pairs: [
        ["A", "D"],
        ["B", "C"],
      ],
      excluded: null,
    });
  });

  it("数値の ID でも、使える（DB の ID と同じ）", () => {
    const result = pairByHistory<number>({
      today: DAY,
      teams: [
        { teamId: 10, handupId: 1, handupAt: 100 },
        { teamId: 2, handupId: 2, handupAt: 200 },
        { teamId: 7, handupId: 3, handupAt: 300 },
      ],
      pastMatches: [],
      limit: null,
      random: flat,
    });

    expect(result).toEqual({ kind: "matched", pairs: [[10, 2]], excluded: 7 });
  });
});

describe("pairByHistory: 純粋であること", () => {
  it("渡した入力を、変更しない", () => {
    const input: PairingInput<string> = {
      today: DAY,
      teams: teams("C", "A", "B"),
      pastMatches: [played("A", "B"), played("A", "C", DAY)],
      limit: 1,
      random: seeded(1),
    };
    const snapshot = JSON.stringify({ teams: input.teams, pastMatches: input.pastMatches });

    pairByHistory(input);

    expect(JSON.stringify({ teams: input.teams, pastMatches: input.pastMatches })).toBe(snapshot);
  });

  it("同じ入力（同じ乱数の列）なら、何度呼んでも、同じ結果", () => {
    const make = () => ({ today: DAY, teams: teams("A", "B", "C", "D", "E"), pastMatches: [played("A", "B"), played("C", "D", DAY)], limit: 3, random: seeded(7) });

    expect(pairByHistory(make())).toEqual(pairByHistory(make()));
  });
});

describe("pairByHistory: 性質（いろいろな入力で）", () => {
  /** いろいろな、チーム数・履歴・規定数を、作る */
  function scenario(seed: number) {
    const random = seeded(seed);
    const n = 2 + Math.floor(random() * 11); // 2〜12 チーム
    const ids = Array.from({ length: n }, (_, i) => `T${i}`);
    const pool = [...ids, "OUT1", "OUT2"];
    const matchCount = Math.floor(random() * 40);
    const past: PastMatch<string>[] = Array.from({ length: matchCount }, () => {
      const a = pool[Math.floor(random() * pool.length)]!;
      let b = pool[Math.floor(random() * pool.length)]!;
      if (b === a) b = pool[(pool.indexOf(a) + 1) % pool.length]!;
      const day = random() < 0.3 ? DAY : `2026-09-${String(1 + Math.floor(random() * 28)).padStart(2, "0")}`;
      return played(a, b, day, Math.floor(random() * 24));
    });
    // 挙手の順は、ばらばら（時刻が、同じになることも、ある）
    const handups = ids.map((teamId, index) => ({ teamId, handupId: index + 1, handupAt: Math.floor(random() * 5) * 100 }));
    const limit = random() < 0.4 ? null : Math.floor(random() * 6);
    return { n, input: { today: DAY, teams: handups, pastMatches: past, limit, random: seeded(seed + 1) } satisfies PairingInput<string> };
  }

  const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

  it("どの入力でも、すべてのチームが、ちょうど 1 回ずつ、組分けか除外に入る（偶数は除外なし、奇数は 1 チームだけ除外）", () => {
    for (const seed of SEEDS) {
      const { n, input } = scenario(seed);
      const result = pairByHistory(input);

      expect(result.kind, `seed=${seed}`).toBe("matched");
      if (result.kind !== "matched") continue;
      const members = [...result.pairs.flat(), ...(result.excluded === null ? [] : [result.excluded])];
      expect(members.sort(), `seed=${seed}`).toEqual(input.teams.map((team) => team.teamId).sort());
      expect(result.pairs, `seed=${seed}`).toHaveLength(Math.floor(n / 2));
      expect(result.excluded === null, `seed=${seed}`).toBe(n % 2 === 0);
    }
  });

  it("どの入力でも、同じ入力・同じ乱数の列なら、同じ結果", () => {
    for (const seed of SEEDS) {
      const a = scenario(seed).input;
      const b = scenario(seed).input;

      expect(pairByHistory(a), `seed=${seed}`).toEqual(pairByHistory(b));
    }
  });

  it("どの入力でも、先頭の組分けは、全組み合わせの中で、いちばん優先される組み合わせの 1 つ（最後の対戦が古く、回数が少ない）", () => {
    for (const seed of SEEDS) {
      const { input } = scenario(seed);
      const result = pairByHistory(input);
      if (result.kind !== "matched" || result.pairs.length === 0) continue;

      // 除外されたチームを除いた、全組み合わせの、(最後の対戦, 回数) を、自分で数える
      const remaining = input.teams.map((team) => team.teamId).filter((id) => id !== result.excluded);
      const stat = (a: string, b: string) => {
        const meets = input.pastMatches.filter((m) => (m.teamAId === a && m.teamBId === b) || (m.teamAId === b && m.teamBId === a));
        return { last: meets.length === 0 ? -Infinity : Math.max(...meets.map((m) => m.at)), count: meets.length };
      };
      const better = (x: { last: number; count: number }, y: { last: number; count: number }) => x.last < y.last || (x.last === y.last && x.count < y.count);
      let best = { last: Infinity, count: Infinity };
      for (let i = 0; i < remaining.length; i++) for (let j = i + 1; j < remaining.length; j++) if (better(stat(remaining[i]!, remaining[j]!), best)) best = stat(remaining[i]!, remaining[j]!);

      // 結果の中で、いちばん優先される組分けが、全体の最優先と、同じ水準であること
      const chosen = result.pairs.map(([a, b]) => stat(a, b));
      const top = chosen.reduce((x, y) => (better(y, x) ? y : x));
      expect(top, `seed=${seed}`).toEqual(best);
    }
  });

  it("奇数のとき、除外されたチームは、規定数を超えているチームがいれば、そのチームの中から選ばれる", () => {
    for (const seed of SEEDS) {
      const { n, input } = scenario(seed);
      if (n % 2 === 0 || input.limit === null) continue;
      const total = (id: string) => input.pastMatches.filter((m) => m.teamAId === id || m.teamBId === id).length;
      const over = input.teams.filter((team) => total(team.teamId) > input.limit!);
      const result = pairByHistory(input);
      if (over.length === 0 || result.kind !== "matched") continue;

      expect(over.map((team) => team.teamId), `seed=${seed}`).toContain(result.excluded);
    }
  });

  it("多くのチームでも、すぐ終わる（40 チーム・履歴 2000 件）", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `T${i}`);
    const random = seeded(99);
    const past = Array.from({ length: 2000 }, () => played(ids[Math.floor(random() * 40)]!, ids[Math.floor(random() * 40)]!, DAY));
    const started = Date.now();

    const result = pairByHistory({ today: DAY, teams: teams(...ids), pastMatches: past, limit: 10, random });

    expect(result).toMatchObject({ kind: "matched", excluded: null });
    expect(Date.now() - started).toBeLessThan(500);
  });
});
