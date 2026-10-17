import { createHandup, createTeam, defaultGuildSettings, saveGuildSettings, saveMatchResult } from "@uc/db";
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
