import { defaultGuildSettings, saveGuildSettings, saveMatchResult } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import { ALICE, KMU_ROLE, UT_ROLE, commandContext, commandInteraction, contentOf, createSeededDb, jst } from "../test-helpers";
import { teams } from "./teams";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;

beforeEach(async () => {
  seeded = await createSeededDb();
});

const run = (input: Parameters<typeof commandInteraction>[0] = { name: "uc-teams" }) =>
  teams(commandContext(seeded.db, commandInteraction({ name: "uc-teams", ...input }), jst("2026-10-07T15:00:00")));

describe("/uc-teams", () => {
  it("チームごとの試合数と、次が何試合目かを、チームの登録順に出す。返信は、本人にだけ見える", async () => {
    await saveMatchResult(seeded.db, { guildId: "200000000000000001", slotDate: "2026-10-06", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, seeded.utId]], now: 1 });
    await saveMatchResult(seeded.db, { guildId: "200000000000000001", slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, seeded.utId]], now: 1 });

    const response = await run();

    expect(contentOf(response)).toBe(
      ["チームごとの試合数", `<@&${KMU_ROLE}>  2試合（次は 3試合目）`, `<@&${UT_ROLE}>  2試合（次は 3試合目）`].join("\n"),
    );
    expect((response.data?.flags ?? 0) & 64).toBe(64);
    expect(response.data?.allowed_mentions).toEqual({ parse: [] });
  });

  it("規定数を超えたチームには、「規定数を超えています」と出る（表示だけ）", async () => {
    await saveGuildSettings(seeded.db, "200000000000000001", { ...defaultGuildSettings, matchLimit: 1 }, 1);
    await saveMatchResult(seeded.db, { guildId: "200000000000000001", slotDate: "2026-10-06", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, seeded.utId]], now: 1 });
    await saveMatchResult(seeded.db, { guildId: "200000000000000001", slotDate: "2026-10-07", slotHour: 21, excludedTeamId: null, pairs: [[seeded.kmuId, seeded.utId]], now: 1 });

    const text = contentOf(await run());

    expect(text).toContain("チームごとの試合数（規定数: 1試合）");
    expect(text).toContain(`<@&${KMU_ROLE}>  2試合（次は 3試合目）　規定数を超えています`);
  });

  it("組まれていないチームは、0 試合（次は 1 試合目）", async () => {
    expect(contentOf(await run())).toContain(`<@&${KMU_ROLE}>  0試合（次は 1試合目）`);
  });

  it("チームに所属していない人も、使える（全員が使える）", async () => {
    const response = await run({ name: "uc-teams", userId: ALICE, roleIds: [] });

    expect(contentOf(response)).toContain("チームごとの試合数");
  });

  it("サーバーの外（DM など）では、使えない", async () => {
    const response = await run({ name: "uc-teams", guildId: null });

    expect(contentOf(response)).toBe("サーバー内で実行してください");
  });
});
