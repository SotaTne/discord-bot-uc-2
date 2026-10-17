import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

// マイグレーションの規則を、テストで守らせる。
// - いちど出した（適用した）マイグレーションは、書き換えない。DB を変えるときは、差分（0001、0002…）を足す
// - 差分を足しても、すでにあるデータが、失われない
// （schema.ts と、マイグレーションが合っているかの確認は、drizzle-kit を使うので、テストではなく、`pnpm --filter @uc/db check:schema` で行う）

const packageDir = join(import.meta.dirname, "..");
const migrationsDir = join(packageDir, "migrations");
const migrationFiles = () => readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();

/**
 * 出した（本番の DB に適用した）マイグレーションの、内容の記録（SHA-256）。書き換えると、すでに適用した DB と、食い違う。
 * 本番に適用したら、そのファイルを、ここに足す。DB を変えるときは、既存のファイルを直さずに、差分（次の番号）を足す。
 */
const RELEASED: Record<string, string> = {
  "0000_dazzling_adam_destine.sql": "5c27cc65707745e94ece62ec338ca0054d09d72c3242f5584f538da3bb09a2c4",
};

describe("マイグレーションは、差分で積む", () => {
  it("出したマイグレーションは、書き換えられていない（内容の記録と、同じ）", () => {
    for (const [file, hash] of Object.entries(RELEASED)) {
      const actual = createHash("sha256").update(readFileSync(join(migrationsDir, file))).digest("hex");
      expect(actual, `${file} を書き換えました。出したあとは、差分（次の番号）を足してください`).toBe(hash);
    }
  });

  it("番号が、0000 から、欠けずに並ぶ（途中を消したり、番号を飛ばしたりしない）", () => {
    const numbers = migrationFiles().map((name) => Number(name.slice(0, 4)));

    expect(numbers).toEqual(numbers.map((_, index) => index));
    expect(numbers.length).toBeGreaterThanOrEqual(2);
  });

  it("試合時刻の表の名前の変更（slots → slot_hours）は、すでにあるデータを、残したまま適用できる", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const [baseline, ...rest] = migrationFiles();
    db.exec(readFileSync(join(migrationsDir, baseline!), "utf8")); // すでに出した状態（0000）
    db.prepare("INSERT INTO slots (guild_id, hour, created_at, deleted_at) VALUES (?, ?, ?, ?)").run("g1", 21, 1, null);
    db.prepare("INSERT INTO slots (guild_id, hour, created_at, deleted_at) VALUES (?, ?, ?, ?)").run("g1", 22, 2, 99);

    for (const file of rest) db.exec(readFileSync(join(migrationsDir, file), "utf8")); // 差分を適用

    expect(db.prepare("SELECT hour, deleted_at AS deletedAt FROM slot_hours ORDER BY hour").all()).toEqual([
      { hour: 21, deletedAt: null },
      { hour: 22, deletedAt: 99 },
    ]);
    expect(() => db.prepare("SELECT * FROM slots").all()).toThrow(/no such table/);
    // 制約も、新しい名前で働く（同じ時刻の二重登録・範囲外の時）
    expect(() => db.prepare("INSERT INTO slot_hours (guild_id, hour, created_at) VALUES ('g1', 21, 3)").run()).toThrow(/UNIQUE/);
    expect(() => db.prepare("INSERT INTO slot_hours (guild_id, hour, created_at) VALUES ('g1', 24, 3)").run()).toThrow(/CHECK/);
  });

  it("得点・勝利・主催・待機の差分（0003〜0007）は、本番に近いデータ（設定・チーム・組分け・勝利・挙手）を、失わずに適用できる", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const files = migrationFiles();
    const upToSlotRename = files.filter((name) => Number(name.slice(0, 4)) <= 2); // すでに本番にある状態（0000〜0002）
    const removal = files.filter((name) => Number(name.slice(0, 4)) >= 3); // これから適用する差分
    for (const file of upToSlotRename) db.exec(readFileSync(join(migrationsDir, file), "utf8"));

    // 本番に近いデータ: 設定（得点の規則・募集の通知先つき）・チーム 2 つ・対戦枠（マッチング済み）・組分け・勝利・挙手
    db.exec(`
      INSERT INTO guild_settings (guild_id, channel_id, recruit_hour, cutoff_minutes, fixed_after_matches, fixed_points, recruit_mention_mode, recruit_mention_targets, created_at, updated_at)
        VALUES ('g1', '300', 10, 5, 3, 80, 'roles', '["400","here"]', 1, 2);
      INSERT INTO teams (id, guild_id, role_id, created_at) VALUES (1, 'g1', 'r1', 1), (2, 'g1', 'r2', 1);
      INSERT INTO match_slots (id, guild_id, slot_date, slot_hour, status, matched_at, created_at) VALUES (1, 'g1', '2026-10-06', 21, 'matched', 5, 1);
      INSERT INTO matches (id, match_slot_id, team_a_id, team_b_id) VALUES (1, 1, 1, 2);
      INSERT INTO wins (guild_id, match_id, team_id, points, active, screenshot_key, recorded_by, created_at) VALUES ('g1', 1, 1, 80, 1, 'shots/a.png', 'admin', 6);
      INSERT INTO handups (guild_id, match_slot_id, team_id, raised_by, created_at) VALUES ('g1', 1, 1, 'alice', 3);
    `);

    for (const file of removal) db.exec(readFileSync(join(migrationsDir, file), "utf8"));

    // 勝利の表と、得点の設定列は、なくなる
    expect(() => db.prepare("SELECT * FROM wins").all()).toThrow(/no such table/);
    expect(() => db.prepare("SELECT fixed_points FROM guild_settings").all()).toThrow(/no such column/);
    // そのほかの設定・チーム・対戦枠・組分け・挙手は、そのまま残る
    expect(db.prepare("SELECT channel_id, recruit_hour, cutoff_minutes, recruit_mention_mode, recruit_mention_targets FROM guild_settings").get()).toEqual({
      channel_id: "300",
      recruit_hour: 10,
      cutoff_minutes: 5,
      recruit_mention_mode: "roles",
      recruit_mention_targets: '["400","here"]',
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM teams").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT status, matched_at FROM match_slots").get()).toEqual({ status: "matched", matched_at: 5 });
    expect(db.prepare("SELECT team_a_id, team_b_id FROM matches").get()).toEqual({ team_a_id: 1, team_b_id: 2 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM handups").get()).toEqual({ n: 1 });
    // 新しい列は、空で入る（古い組分けの主催は、空。表示のときに、計算で補う）
    expect(db.prepare("SELECT host_team_id FROM matches").get()).toEqual({ host_team_id: null });
    expect(db.prepare("SELECT waiting_since, waiting_message_id, waiting_announce_message_id FROM match_slots").get()).toEqual({
      waiting_since: null,
      waiting_message_id: null,
      waiting_announce_message_id: null,
    });
    // 試合数の規定数（0007）は、空（規定数なし）で入り、あとから、書ける
    expect(db.prepare("SELECT match_limit FROM guild_settings").get()).toEqual({ match_limit: null });
    db.exec("UPDATE guild_settings SET match_limit = 8");
    expect(db.prepare("SELECT match_limit FROM guild_settings").get()).toEqual({ match_limit: 8 });
    // 外部キーの整合性が、保たれている（壊れた参照が、1 つもない）
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    // 新しい列が、実際に、使える（主催は、2 チームのどちらか、待機の情報も、書ける）
    db.exec("UPDATE matches SET host_team_id = 2 WHERE id = 1; UPDATE match_slots SET waiting_since = 9, waiting_message_id = 'm1', waiting_announce_message_id = 'm2' WHERE id = 1;");
    expect(db.prepare("SELECT host_team_id FROM matches").get()).toEqual({ host_team_id: 2 });
    expect(() => db.exec("UPDATE matches SET host_team_id = 999 WHERE id = 1")).toThrow(/FOREIGN KEY/);
  });
});
