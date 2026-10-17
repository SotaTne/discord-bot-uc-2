import { addMatch, createHandup, createTeam, defaultGuildSettings, listMatchedSlots, saveGuildSettings, saveMatchResult } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { GUILD_ID, KMU_ROLE, UT_ROLE, createSeededDb, jst } from "../test-helpers";
import { confirmMatching } from "./confirm-matching";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
let posted: string[];

const rest = {
  async createMessage(_channelId: string, payload: { content?: string }) {
    posted.push(payload.content ?? "");
    return { id: String(posted.length) };
  },
};

beforeEach(async () => {
  seeded = await createSeededDb();
  posted = [];
  // 挙手の順: KMU → UT（組分けは [KMU, UT] の順になる）
  for (const [teamId, createdAt] of [[seeded.kmuId, 1], [seeded.utId, 2]] as const) {
    await createHandup(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId, raisedBy: "u", createdAt });
  }
});

const confirm = (random: () => number) =>
  confirmMatching(
    { db: seeded.db, rest, random },
    { guildId: GUILD_ID, channelId: "300000000000000001", slotDate: "2026-10-07", slotHour: 21, now: new Date(jst("2026-10-07T20:53:00")) },
  );

describe("confirmMatching: 対戦履歴を見て、組み合わせを決める", () => {
  const GUILD = GUILD_ID;
  let ngt: number;
  let itf: number;

  beforeEach(async () => {
    ngt = await createTeam(seeded.db, { guildId: GUILD, roleId: "400000000000000003", createdAt: 1 });
    itf = await createTeam(seeded.db, { guildId: GUILD, roleId: "400000000000000004", createdAt: 1 });
  });

  /** 22 時の対戦枠に、4 チームが、KMU → UT → NGT → ITF の順で挙手する */
  const raiseFour = async () => {
    for (const [index, teamId] of [seeded.kmuId, seeded.utId, ngt, itf].entries()) {
      await createHandup(seeded.db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 22, teamId, raisedBy: "u", createdAt: 10 + index });
    }
  };
  const confirm22 = () =>
    confirmMatching(
      { db: seeded.db, rest, random: () => 0.5 },
      { guildId: GUILD, channelId: "300000000000000001", slotDate: "2026-10-07", slotHour: 22, now: new Date(jst("2026-10-07T21:53:00")) },
    );
  const lastPairs = async () => (await listMatchedSlots(seeded.db, { guildId: GUILD, slotDate: "2026-10-07" })).find((slot) => slot.slotHour === 22)!;

  it("履歴がなければ、挙手の早い順に、隣どうしを組む（これまでと同じ）", async () => {
    await raiseFour();

    await confirm22();

    expect((await lastPairs()).pairs.map((pair) => [pair.teamAId, pair.teamBId])).toEqual([[seeded.kmuId, seeded.utId], [ngt, itf]]);
  });

  it("前の日に対戦した相手は、あとにする（KMU-UT が前の日に対戦していたら、KMU は、NGT と組む）", async () => {
    await saveMatchResult(seeded.db, { guildId: GUILD, slotDate: "2026-10-06", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, seeded.utId]], now: 1 });
    await raiseFour();

    await confirm22();

    expect((await lastPairs()).pairs.map((pair) => [pair.teamAId, pair.teamBId])).toEqual([[seeded.kmuId, ngt], [seeded.utId, itf]]);
  });

  it("管理者が先に組んだチームは、自動のマッチングの対象から外れる（履歴は、その組分けも数える）", async () => {
    await raiseFour();
    await addMatch(seeded.db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 22, teamAId: seeded.kmuId, teamBId: itf, createdAt: 1 });

    await confirm22();

    const pairs = (await lastPairs()).pairs.map((pair) => [pair.teamAId, pair.teamBId].sort());
    expect(pairs).toContainEqual([seeded.kmuId, itf].sort());
    expect(pairs).toContainEqual([seeded.utId, ngt].sort());
    expect(pairs).toHaveLength(2);
  });

  it("奇数で、規定数（サーバー設定）を超えているチームがいれば、そのチームを除外する（挙手が遅くなくても）", async () => {
    await saveGuildSettings(seeded.db, GUILD, { ...defaultGuildSettings, matchLimit: 1 }, 1);
    // KMU は、これまでに 2 試合（規定数 1 を超えている）
    await saveMatchResult(seeded.db, { guildId: GUILD, slotDate: "2026-10-05", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, itf]], now: 1 });
    await saveMatchResult(seeded.db, { guildId: GUILD, slotDate: "2026-10-06", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, itf]], now: 1 });
    for (const [index, teamId] of [seeded.kmuId, seeded.utId, ngt].entries()) {
      await createHandup(seeded.db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 22, teamId, raisedBy: "u", createdAt: 10 + index });
    }

    await confirm22();

    const slot = await lastPairs();
    expect(slot.excludedTeamId).toBe(seeded.kmuId);
    expect(slot.pairs.map((pair) => [pair.teamAId, pair.teamBId])).toEqual([[seeded.utId, ngt]]);
  });

  it("奇数で、規定数が決まっていなければ、当日の試合数が多いチームを、除外する（挙手が遅い順の前に）", async () => {
    // 当日の 21 時に、KMU が試合をしている。22 時は、KMU・UT・NGT が挙手
    await saveMatchResult(seeded.db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, itf]], now: 1 });
    for (const [index, teamId] of [seeded.kmuId, seeded.utId, ngt].entries()) {
      await createHandup(seeded.db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 22, teamId, raisedBy: "u", createdAt: 10 + index });
    }

    await confirm22();

    expect((await lastPairs()).excludedTeamId).toBe(seeded.kmuId);
  });

  it("挙手が奇数で、当日の試合数も同じなら、最後に挙手したチームを除外する（これまでと同じ）", async () => {
    for (const [index, teamId] of [seeded.kmuId, seeded.utId, ngt].entries()) {
      await createHandup(seeded.db, { guildId: GUILD, slotDate: "2026-10-07", slotHour: 22, teamId, raisedBy: "u", createdAt: 10 + index });
    }

    await confirm22();

    expect((await lastPairs()).excludedTeamId).toBe(ngt);
  });
});

describe("confirmMatching: 試合数の規定数（サーバー設定）", () => {
  it("規定数を超える試合になるチームには、結果の投稿に「規定数超過」が付く。超えないチームには付かない", async () => {
    await saveGuildSettings(seeded.db, GUILD_ID, { ...defaultGuildSettings, matchLimit: 1 }, 1);
    // KMU は、すでに 1 試合している（UT は 0 試合）。今回の組分けが、KMU は 2 試合目（超過）、UT は 1 試合目
    const third = await createTeam(seeded.db, { guildId: GUILD_ID, roleId: "400000000000000009", createdAt: 1 });
    await saveMatchResult(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-06", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, third]], now: 1 });

    await confirm(() => 0.1);

    expect(posted[0]).toContain(`<@&${KMU_ROLE}>（2試合目・規定数超過） vs <@&${UT_ROLE}>（1試合目）`);
  });
});

// 乱数を差し替えて、主催が、乱数だけで決まることを確かめる（本物の乱数に、テストの結果が左右されない）
describe("confirmMatching: 主催（乱数で決まる）", () => {
  it("乱数が小さければ、1 チーム目（先に挙手したチーム）が主催", async () => {
    await confirm(() => 0.1);

    expect(posted[0]).toBe(["## 試合 (時間:21時) の組分け:", `- <@&${KMU_ROLE}>（1試合目） vs <@&${UT_ROLE}>（1試合目）・主催: <@&${KMU_ROLE}>`].join("\n"));
  });

  it("乱数が大きければ、2 チーム目が主催", async () => {
    await confirm(() => 0.9);

    expect(posted[0]).toBe(["## 試合 (時間:21時) の組分け:", `- <@&${KMU_ROLE}>（1試合目） vs <@&${UT_ROLE}>（1試合目）・主催: <@&${UT_ROLE}>`].join("\n"));
  });
});
