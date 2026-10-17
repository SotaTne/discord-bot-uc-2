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

  describe("対戦枠ごとの表示（誰と対戦か / 締切か / 受付中か）", () => {
    const opponent = { id: 2, guildId: GUILD_ID, roleId: "400000000000000002", createdAt: 1, deletedAt: null } satisfies Team;
    const text = (slots: Parameters<typeof formatStatus>[0]["slots"], matchCount?: number) =>
      formatStatus({ team, slotDate: "2026-10-07", ...(matchCount === undefined ? {} : { matchCount }), slots }).split("\n");

    it("これまでの試合数と、次が何試合目かを、見出しの下に出す", () => {
      expect(text([], 4)[1]).toBe("これまで 4 試合（次の試合は 5 試合目）");
    });

    it("組まれた試合が規定数を超えていれば、その対戦枠の行にも「規定数超過」を付ける", () => {
      const line = (over: boolean) =>
        text([{ hour: 21, phase: "closed", handups: [], matched: true, match: { opponent, number: 6, host: opponent, over } }]).find((row) => row.startsWith("- 21時"));

      expect(line(true)).toBe(`- 21時: <@&${opponent.roleId}> と対戦（6試合目・規定数超過・主催: <@&${opponent.roleId}>）`);
      expect(line(false)).toBe(`- 21時: <@&${opponent.roleId}> と対戦（6試合目・主催: <@&${opponent.roleId}>）`);
    });

    it("試合数が規定数を超えていれば、見出しの下に、小さな字で出す。ちょうど規定数・規定数なしは、出さない", () => {
      const withLimit = (count: number, limit: number | null) => formatStatus({ team, slotDate: "2026-10-07", matchCount: count, matchLimit: limit, slots: [] }).split("\n");

      expect(withLimit(6, 5)[2]).toBe("-# 試合数が規定数（5試合）を超えています");
      expect(withLimit(5, 5).join("\n")).not.toContain("規定数");
      expect(withLimit(6, null).join("\n")).not.toContain("規定数");
    });

    it("マッチング済みで、組まれたなら、誰と対戦するか（何試合目か・主催）を出す", () => {
      const lines = text([{ hour: 21, phase: "closed", handups: [], matched: true, match: { opponent, number: 4, host: opponent } }]);

      expect(lines).toContain(`- 21時: <@&${opponent.roleId}> と対戦（4試合目・主催: <@&${opponent.roleId}>）`);
    });

    it("マッチング済みで、奇数のために組まれなかったなら、その旨を出す。挙手がなく組まれていないときも、その旨", () => {
      const lines = text([
        { hour: 21, phase: "closed", handups: [], matched: true, excluded: true },
        { hour: 22, phase: "closed", handups: [], matched: true },
      ]);

      expect(lines).toContain("- 21時: 組まれませんでした（挙手が奇数のため）");
      expect(lines).toContain("- 22時: マッチング済み（組まれていません）");
    });

    it("継続募集中なら、「マッチング済み」や「締切」ではなく、継続募集中（誰が待機中か）を出す。待機しているのが自チームなら、その旨", () => {
      const waiting = { id: 3, guildId: GUILD_ID, roleId: "400000000000000003", createdAt: 1, deletedAt: null } satisfies Team;
      const lines = text([
        { hour: 21, phase: "closed", handups: [], matched: true, continued: { waiting, self: false } },
        { hour: 22, phase: "closed", handups: [], matched: true, excluded: true, continued: { waiting: team, self: true } },
      ]);

      expect(lines).toContain(`- 21時: 継続募集中（<@&${waiting.roleId}> が待機中。21:00 までに、先着 1 チームが対戦できます）`);
      expect(lines).toContain("- 22時: 待機中（22:00 まで、対戦相手を募集しています）");
      expect(lines.join("\n")).not.toContain("マッチング済み");
    });

    it("まだマッチングされていないなら、締切か、受付中か、受付前かを出す（挙手の有無も）", () => {
      const lines = text([
        { hour: 21, phase: "closed", handups: [] },
        { hour: 22, phase: "open", handups: [] },
        { hour: 23, phase: "before-open", handups: [] },
      ]);

      expect(lines).toContain("- 21時: 未挙手・締切（マッチング待ち）");
      expect(lines).toContain("- 22時: 未挙手・受付中");
      expect(lines).toContain("- 23時: 未挙手・受付前");
    });
  });
});
