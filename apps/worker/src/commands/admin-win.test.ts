import { findMatchForTeam, listWins, saveMatchResult, setWinActive } from "@uc/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_USER,
  GUILD_ID,
  KMU_ROLE,
  UT_ROLE,
  adminInteraction,
  commandInteraction,
  commandKit,
  contentOf,
  createSeededDb,
  jst,
  timeOption,
  insertWinInSlot,
} from "../test-helpers";
import { adminWin } from "./admin-win";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
/** KMU と UT が対戦する、マッチング済みの対戦枠 */
const played = (slotDate: string, slotHour: number) =>
  saveMatchResult(seeded.db, { guildId: GUILD_ID, slotDate, slotHour, excludedTeamId: null, pairs: [[seeded.kmuId, seeded.utId]], now: 1 });

beforeEach(async () => {
  seeded = await createSeededDb();
  await played("2026-10-07", 21);
  await played("2026-10-06", 23);
  await played("2026-09-30", 21);
});

const NOW = jst("2026-10-07T22:30:00");
const IMAGE_URL = "https://cdn.example/shot.png";

const attachments = (overrides: { content_type?: string; size?: number } = {}) => ({
  "900": { id: "900", url: IMAGE_URL, filename: "shot.png", content_type: "image/png", size: 2048, ...overrides },
});

const options = (hour = 21, extra: { name: string; type: number; value: string | number }[] = [], points = 80) => [
  timeOption(hour),
  { name: "team-role", type: 8, value: KMU_ROLE },
  { name: "point", type: 4, value: points },
  { name: "image", type: 11, value: "900" },
  ...extra,
];

const imageFetch: typeof fetch = async (input) => {
  expect(String(input)).toBe(IMAGE_URL);
  return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "Content-Type": "image/png" } });
};

function run(
  interaction = adminInteraction({ name: "uc-admin-win", options: options(), attachments: attachments() }),
  fetchImpl: typeof fetch = imageFetch,
) {
  const kit = commandKit(seeded.db, interaction, NOW, { fetch: fetchImpl });
  return adminWin(kit.context).then((response) => ({ response, kit }));
}

describe("/uc-admin-win", () => {
  it("勝利を追加する。まず「考え中」を返し、結果は返信の編集で伝える（記録者・画像・点数が残る）", async () => {
    const { response, kit } = await run();

    expect(response.type).toBe(5);
    expect(kit.edits).toEqual([]);

    await kit.flush();

    expect(kit.edits).toHaveLength(1);
    expect(kit.edits[0]?.applicationId).toBe("100000000000000001");
    expect(kit.edits[0]?.token).toBe("test-token");
    expect(kit.edits[0]?.content).toBe(
      [
        `<@&${KMU_ROLE}> 2026-10-07 21時（<@&${KMU_ROLE}> vs <@&${UT_ROLE}>）の勝利を追加しました（80pt）`,
        "- 3試合目: 集計は80ptです",
      ].join("\n"),
    );

    const [event] = await listWins(seeded.db, GUILD_ID);
    expect(event).toMatchObject({
      teamId: seeded.kmuId, active: true, slotDate: "2026-10-07", slotHour: 21, points: 80, recordedBy: ADMIN_USER, matchId: expect.any(Number),
    });
    expect(kit.r2.objects.get(event?.screenshotKey ?? "")).toEqual({ contentType: "image/png", bytes: 4 });
    expect(event?.screenshotKey).toMatch(new RegExp(`^screenshots/${GUILD_ID}/[0-9a-f-]{36}\\.png$`));
  });

  describe("日付", () => {
    const savedDate = async (interaction: ReturnType<typeof adminInteraction>) => {
      const { kit } = await run(interaction);
      await kit.flush();
      return (await listWins(seeded.db, GUILD_ID))[0]?.slotDate;
    };

    it("省略すると、今より前で一番直近のその時刻の対戦枠（始まっている対戦枠は今日）", async () => {
      expect(await savedDate(adminInteraction({ name: "x", options: options(21), attachments: attachments() }))).toBe("2026-10-07");
    });

    it("省略したとき、今日の対戦枠がまだなら前日になる", async () => {
      expect(await savedDate(adminInteraction({ name: "x", options: options(23), attachments: attachments() }))).toBe("2026-10-06");
    });

    it("指定すれば、その日付で記録する", async () => {
      const date = { name: "date", type: 3, value: "2026-09-30" };
      expect(await savedDate(adminInteraction({ name: "x", options: options(21, [date]), attachments: attachments() }))).toBe("2026-09-30");
    });
  });

  describe("集計と照合の表示", () => {
    it("N（5）試合を超えた試合では、集計が一律100ptになることを伝える", async () => {
      for (let day = 1; day <= 5; day++) {
        await insertWinInSlot(seeded.db, {
          guildId: GUILD_ID, teamId: seeded.kmuId, slotDate: `2026-09-0${day}`, slotHour: 21, points: 10, screenshotKey: null, recordedBy: "a", createdAt: day,
        });
      }
      const { kit } = await run();
      await kit.flush();

      expect(kit.edits[0]?.content).toContain("- 8試合目: 5試合を超えているので、集計は一律100ptになります");
    });
  });

  describe("勝利は、マッチングで組まれた試合に紐づく", () => {
    it("記録した勝利は、その対戦枠でそのチームが出る試合に紐づく", async () => {
      const { kit } = await run();
      await kit.flush();

      const [event] = await listWins(seeded.db, GUILD_ID);
      const match = await findMatchForTeam(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 21, teamId: seeded.kmuId });
      expect(event?.matchId).toBe(match?.matchId);
    });

    const refused = async (interaction: ReturnType<typeof adminInteraction>) => {
      const { response, kit } = await run(interaction);
      expect(response.type).toBe(4);
      expect(kit.r2.objects.size).toBe(0);
      expect(await listWins(seeded.db, GUILD_ID)).toEqual([]);
      return contentOf(response);
    };

    it("その組分けに、すでに有効な勝利があれば、記録できない（削除してから、記録し直す）。削除すれば、記録できる", async () => {
      const first = await run();
      await first.kit.flush();
      const [recorded] = await listWins(seeded.db, GUILD_ID);

      const again = await run();
      expect(contentOf(again.response)).toBe(
        "その組分けには、すでに勝利が記録されています。ダッシュボードの「対戦枠」で削除してから、記録し直してください",
      );
      expect(again.response.type).toBe(4);
      expect(again.kit.r2.objects.size).toBe(0);
      expect(await listWins(seeded.db, GUILD_ID)).toHaveLength(1);

      await setWinActive(seeded.db, { guildId: GUILD_ID, id: recorded!.id, active: false });
      const retry = await run();
      await retry.kit.flush();
      expect(await listWins(seeded.db, GUILD_ID)).toHaveLength(2);
    });

    it("マッチングされていない対戦枠には、記録できない（何も保存しない）", async () => {
      const interaction = adminInteraction({ name: "x", options: options(22, [{ name: "date", type: 3, value: "2026-10-07" }]), attachments: attachments() });

      expect(await refused(interaction)).toBe(
        `2026-10-07 22時に、<@&${KMU_ROLE}> の試合はありません（マッチングされていないか、対戦していません）`,
      );
    });

    it("その対戦枠で対戦していないチーム（除外されたチームなど）には、記録できない", async () => {
      await saveMatchResult(seeded.db, { guildId: GUILD_ID, slotDate: "2026-10-07", slotHour: 22, excludedTeamId: seeded.kmuId, pairs: [], now: 1 });
      const interaction = adminInteraction({ name: "x", options: options(22, [{ name: "date", type: 3, value: "2026-10-07" }]), attachments: attachments() });

      expect(await refused(interaction)).toContain("の試合はありません");
    });
  });
  describe("記録できないとき（何も保存しない）", () => {
    const rejected = async (interaction: ReturnType<typeof adminInteraction>) => {
      const { response, kit } = await run(interaction);
      expect(response.type).toBe(4);
      expect(kit.r2.objects.size).toBe(0);
      expect(await listWins(seeded.db, GUILD_ID)).toEqual([]);
      return contentOf(response);
    };

    it("管理者でない", async () => {
      const interaction = commandInteraction({ name: "uc-admin-win", options: options(), attachments: attachments() });
      expect(await rejected(interaction)).toBe("管理者権限を持たないユーザーはこのコマンドを使えません");
    });

    it("必須のオプションがない", async () => {
      expect(await rejected(adminInteraction({ name: "x", options: [timeOption(21)], attachments: attachments() }))).toBe(
        "必須のオプションが指定されていません",
      );
    });

    it("点数が負", async () => {
      expect(await rejected(adminInteraction({ name: "x", options: options(21, [], -1), attachments: attachments() }))).toBe(
        "点数は0以上で指定してください",
      );
    });

    it("日付の形式が違う・存在しない日付", async () => {
      for (const value of ["2026/10/07", "2026-02-30"]) {
        const date = { name: "date", type: 3, value };
        expect(await rejected(adminInteraction({ name: "x", options: options(21, [date]), attachments: attachments() }))).toBe(
          "日付は YYYY-MM-DD の形式で、実在する日付を指定してください",
        );
      }
    });

    it("チームとして登録されていないロール", async () => {
      const other = options().map((o) => (o.name === "team-role" ? { ...o, value: "999" } : o));
      expect(await rejected(adminInteraction({ name: "x", options: other, attachments: attachments() }))).toBe(
        "チームとして登録されていないロールです",
      );
    });

    it("登録されていない試合時刻", async () => {
      expect(await rejected(adminInteraction({ name: "x", options: options(20), attachments: attachments() }))).toBe(
        "20時の試合時刻は登録されていません",
      );
    });

    it("添付ファイルが見つからない・画像でない・大きすぎる", async () => {
      expect(await rejected(adminInteraction({ name: "x", options: options() }))).toBe("画像が見つかりません");
      expect(
        await rejected(adminInteraction({ name: "x", options: options(), attachments: attachments({ content_type: "application/pdf" }) })),
      ).toBe("画像（PNG・JPEG・WebP・GIF）を指定してください");
      expect(
        await rejected(adminInteraction({ name: "x", options: options(), attachments: attachments({ size: 9 * 1024 * 1024 }) })),
      ).toBe("画像は8MB以下にしてください");
    });
  });

  describe("画像の取得に失敗したとき", () => {
    it("記録も画像の保存もせず、失敗を伝える", async () => {
      const failing: typeof fetch = async () => new Response("gone", { status: 404 });
      const { kit } = await run(undefined, failing);
      await kit.flush();

      expect(kit.edits[0]?.content).toBe("勝利の記録に失敗しました。もう一度お試しください");
      expect(kit.r2.objects.size).toBe(0);
      expect(await listWins(seeded.db, GUILD_ID)).toEqual([]);
    });
  });
});

describe("結果の返信（deferred の編集）", () => {
  const sleepsFor = async (editFailures: number[]) => {
    const interaction = adminInteraction({ name: "uc-admin-win", options: options(), attachments: attachments() });
    const kit = commandKit(seeded.db, interaction, NOW, { fetch: imageFetch, editFailures });
    await adminWin(kit.context);
    await kit.flush();
    return kit;
  };

  it("Discord が最初の応答をまだ受け取っていない間（404）は、待ってやり直して、結果を届ける", async () => {
    const kit = await sleepsFor([404, 404]);

    expect(kit.sleeps).toEqual([300, 600]);
    expect(kit.edits).toHaveLength(1);
    expect(kit.edits[0]?.content).toContain("勝利を追加しました");
  });

  it("404 が続いても、5回で諦める（記録そのものは済んでいる）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const kit = await sleepsFor([404, 404, 404, 404, 404, 404]);

    expect(kit.sleeps).toEqual([300, 600, 900, 1200]);
    expect(kit.edits).toEqual([]);
    expect(await listWins(seeded.db, GUILD_ID)).toHaveLength(1);
  });

  it("404 以外のエラーは、やり直さない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const kit = await sleepsFor([500]);

    expect(kit.sleeps).toEqual([]);
    expect(kit.edits).toEqual([]);
  });
});
