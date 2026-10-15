import type { Handup, Team } from "@uc/db";
import { describe, expect, it } from "vitest";
import { BOB, GUILD_ID, KMU_ROLE, jst } from "../test-helpers";
import { formatStatus } from "./status";

describe("formatStatus", () => {
  const team = { id: 1, guildId: GUILD_ID, roleId: KMU_ROLE, createdAt: 1, deletedAt: null } satisfies Team;

  it("試合時刻が登録されていなければ、その旨を返す", () => {
    expect(formatStatus({ team, slotDate: "2026-10-07", slots: [] })).toBe(
      `<@&${KMU_ROLE}> の挙手状況（2026-10-07）\n試合時刻が登録されていません`,
    );
  });

  it("挙手があれば、挙手済み（挙手した人と時刻）として表示する。なければ未挙手", () => {
    const handups: Handup[] = [
      { id: 2, guildId: GUILD_ID, matchSlotId: 1, slotDate: "2026-10-07", slotHour: 21, teamId: 1, raisedBy: BOB, createdAt: jst("2026-10-07T14:00:00").getTime() },
    ];

    const text = formatStatus({ team, slotDate: "2026-10-07", slots: [{ hour: 21, phase: "open", handups }] });

    expect(text).toContain(`- 21時: 挙手済み（by <@${BOB}>, 14:00）・受付中`);
    expect(formatStatus({ team, slotDate: "2026-10-07", slots: [{ hour: 21, phase: "open", handups: [] }] })).toContain("- 21時: 未挙手・受付中");
  });

  it("これまでの試合数と、次が何試合目かを、見出しの下に出す。組まれた対戦枠には、何試合目かを添える", () => {
    const text = formatStatus({
      team,
      slotDate: "2026-10-07",
      matchCount: 4,
      slots: [
        { hour: 21, phase: "closed", handups: [], matched: true, matchNumber: 4 },
        { hour: 22, phase: "open", handups: [] },
      ],
    });

    expect(text.split("\n").slice(0, 2)).toEqual([`<@&${KMU_ROLE}> の挙手状況（2026-10-07）`, "これまで 4 試合（次の試合は 5 試合目）"]);
    expect(text).toContain("- 21時: 未挙手・マッチング済み・4試合目");
    expect(text).toContain("- 22時: 未挙手・受付中\n".trimEnd());
  });
});
