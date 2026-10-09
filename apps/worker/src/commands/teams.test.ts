import { deleteAllMatches, deleteAllWins, type Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { GUILD_ID, KMU_ROLE, UT_ROLE, commandContext, commandInteraction, contentOf, createSeededDb, insertWinInSlot, jst } from "../test-helpers";
import { teams } from "./teams";

describe("/uc-teams", () => {
  const run = (seeded: Awaited<ReturnType<typeof createSeededDb>>) =>
    teams(commandContext(seeded.db, commandInteraction({ name: "uc-teams" }), jst("2026-10-07T15:00:00")));

  const win = (seeded: Awaited<ReturnType<typeof createSeededDb>>, teamId: number, day: number, points: number) =>
    insertWinInSlot(seeded.db, {
      guildId: GUILD_ID, teamId, slotDate: `2026-10-0${day}`, slotHour: 21, points, screenshotKey: null, recordedBy: "admin", createdAt: day,
    });

  it("記録された勝利から、チームごとの得点を出す（本人にだけ見える）", async () => {
    const seeded = await createSeededDb();
    await win(seeded, seeded.kmuId, 1, 80);
    await win(seeded, seeded.kmuId, 2, 70);
    await win(seeded, seeded.utId, 1, 60);

    const response = await run(seeded);

    expect(contentOf(response)).toBe(["# チームの得点", `1位 <@&${KMU_ROLE}> 150pt（2試合・2勝）`, `2位 <@&${UT_ROLE}> 60pt（2試合・1勝）`].join("\n"));
    expect(response.data?.flags).toBe(64);
  });

  it("6試合目からは、勝っても、生点に関係なく一律100ptで集計する", async () => {
    const seeded = await createSeededDb();
    for (let day = 1; day <= 6; day++) await win(seeded, seeded.kmuId, day, 10);

    expect(contentOf(await run(seeded))).toContain(`<@&${KMU_ROLE}> 150pt（6試合・6勝・試合数5を超過しました）`);
  });

  it("得点のクリア（履歴の削除）のあとは、試合数も、1試合目から数え直す（組分けも消えるので）", async () => {
    const seeded = await createSeededDb();
    await win(seeded, seeded.kmuId, 1, 80);
    await deleteAllWins(seeded.db, GUILD_ID);
    await deleteAllMatches(seeded.db, GUILD_ID);
    await win(seeded, seeded.utId, 2, 30);

    const lines = contentOf(await run(seeded)).split("\n");

    expect(lines).toContain(`1位 <@&${UT_ROLE}> 30pt（1試合・1勝）`);
    expect(lines).toContain(`2位 <@&${KMU_ROLE}> 0pt（1試合・0勝）`);
  });

  it("サーバーの外で実行したときは、その旨を返す", async () => {
    const seeded = await createSeededDb();
    const response = await teams(commandContext(seeded.db, commandInteraction({ name: "uc-teams", guildId: null }), jst("2026-10-07T15:00:00")));
    expect(contentOf(response)).toBe("サーバー内で実行してください");
  });
});
