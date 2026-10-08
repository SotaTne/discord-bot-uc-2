import { listWins, setWinActive } from "@uc/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GUILD_ID,
  adminInteraction,
  commandContext,
  commandInteraction,
  commandKit,
  contentOf,
  createSeededDb,
  insertWinInSlot,
  jst,
} from "../test-helpers";
import { scoreClear, scoreClearComponent } from "./score-clear";

let seeded: Awaited<ReturnType<typeof createSeededDb>>;
beforeEach(async () => {
  seeded = await createSeededDb();
});

const NOW = jst("2026-10-07T15:00:00");
const slash = (interaction: ReturnType<typeof commandInteraction>) =>
  scoreClear(commandContext(seeded.db, interaction, NOW));
/** 確認のボタンを押す。R2（画像）の代わりも返す */
function pressButton(interaction: ReturnType<typeof commandInteraction>) {
  const kit = commandKit(seeded.db, interaction, NOW);
  return scoreClearComponent(kit.context).then((response) => ({ response, kit }));
}
const click = (interaction: ReturnType<typeof commandInteraction>) => pressButton(interaction).then(({ response }) => response);

/** 勝利を2つ記録しておく（1つは画像つき。それを、無効にしてある） */
async function seedHistory(r2?: { bucket: R2Bucket }) {
  const key = "screenshots/g/a.png";
  await r2?.bucket.put(key, new ArrayBuffer(4));
  const first = await insertWinInSlot(seeded.db, { guildId: GUILD_ID, teamId: seeded.kmuId, slotDate: "2026-10-06", slotHour: 21, points: 80, screenshotKey: key, recordedBy: "a", createdAt: 1 });
  await insertWinInSlot(seeded.db, { guildId: GUILD_ID, teamId: seeded.utId, slotDate: "2026-10-06", slotHour: 22, points: 50, screenshotKey: null, recordedBy: "a", createdAt: 2 });
  await setWinActive(seeded.db, { guildId: GUILD_ID, id: first, active: false });
  return key;
}
const clickAs = (customId: string) => adminInteraction({ customId });
const events = () => listWins(seeded.db, GUILD_ID);

describe("/uc-admin-score-clear（確認の表示）", () => {
  it("管理者でなければ使えない", async () => {
    const response = await slash(commandInteraction({ name: "uc-admin-score-clear" }));
    expect(contentOf(response)).toBe("管理者権限を持たないユーザーはこのコマンドを使えません");
  });

  it("本人にだけ見える確認のボタンを出す（まだ消さない）", async () => {
    await seedHistory();
    const response = await slash(adminInteraction({ name: "uc-admin-score-clear" }));

    expect(contentOf(response)).toContain("すべてのチームの得点と、勝利の履歴（画像を含む）、組分け（試合数）を削除します");
    expect(response.data?.flags).toBe(64);
    expect(response.data?.components?.[0]?.components.map((b) => [b.label, b.custom_id])).toEqual([
      ["全てクリア", "score-clear:confirm"],
      ["キャンセル", "score-clear:cancel"],
    ]);
    expect(await events()).toHaveLength(2);
  });
});

describe("確認のボタン", () => {
  it("「全てクリア」で、すべての勝利・打ち消しを削除して、メッセージを置き換える（ボタンは消える）。画像も消える", async () => {
    const kit = commandKit(seeded.db, clickAs("score-clear:confirm"), NOW);
    const key = await seedHistory(kit.r2);
    expect(kit.r2.objects.has(key)).toBe(true);

    const response = await scoreClearComponent(kit.context);

    expect(response).toEqual({
      type: 7,
      data: { content: "すべてのチームの得点と、勝利の履歴・組分けを削除しました", components: [], allowed_mentions: { parse: [] } },
    });
    expect(await events()).toEqual([]);
    expect(kit.r2.objects.has(key)).toBe(false);
  });

  it("「キャンセル」では、何も記録しない", async () => {
    await seedHistory();
    const response = await click(clickAs("score-clear:cancel"));

    expect(contentOf(response)).toBe("キャンセルしました");
    expect(await events()).toHaveLength(2);
  });

  it("押した人が管理者でなければ、何も記録しない（ボタンを渡されても実行できない）", async () => {
    await seedHistory();
    const response = await click(commandInteraction({ customId: "score-clear:confirm" }));

    expect(contentOf(response)).toBe("管理者権限を持たないユーザーはこのコマンドを使えません");
    expect(await events()).toHaveLength(2);
  });

  it("不正な ID（以前の、チーム指定のボタンも）では、何も消さない", async () => {
    await seedHistory();
    expect(contentOf(await click(clickAs("score-clear:confirm:all")))).toBe("この操作は無効です");
    expect(contentOf(await click(clickAs("score-clear:confirm:1")))).toBe("この操作は無効です");
    expect(contentOf(await click(clickAs("score-clear:other")))).toBe("この操作は無効です");
    expect(await events()).toHaveLength(2);
  });
});
