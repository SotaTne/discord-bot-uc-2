import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "./testing";

const GUILD = "100";
const NOW = 1_700_000_000_000;

let db: DatabaseSync;

beforeEach(() => {
  db = createTestDatabase();
});

/** チームを作る。第1引数は、テストの読みやすさのための呼び名（チームはロールだけで決まるので、保存しない） */
function insertTeam(_label: string, roleId: string, guildId = GUILD): number {
  const result = db
    .prepare("INSERT INTO teams (guild_id, role_id, created_at) VALUES (?, ?, ?)")
    .run(guildId, roleId, NOW);
  return Number(result.lastInsertRowid);
}

/** 対戦枠（日付 × 枠）。同じものがあれば、それを使う */
function matchSlotId(slotHour = 21, slotDate = "2026-10-07"): number {
  db.prepare("INSERT OR IGNORE INTO match_slots (guild_id, slot_date, slot_hour, created_at) VALUES (?, ?, ?, ?)").run(
    GUILD,
    slotDate,
    slotHour,
    NOW,
  );
  const row = db
    .prepare("SELECT id FROM match_slots WHERE guild_id = ? AND slot_date = ? AND slot_hour = ?")
    .get(GUILD, slotDate, slotHour) as { id: number };
  return row.id;
}

function insertHandup(teamId: number, slotHour = 21, slotDate = "2026-10-07") {
  return db
    .prepare("INSERT INTO handups (guild_id, match_slot_id, team_id, raised_by, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(GUILD, matchSlotId(slotHour, slotDate), teamId, "user-1", NOW);
}

describe("match_slots（対戦枠）", () => {
  const insertFixture = (hour: number, status = "open", matchedAt: number | null = null) =>
    db
      .prepare("INSERT INTO match_slots (guild_id, slot_date, slot_hour, status, matched_at, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(GUILD, "2026-10-07", hour, status, matchedAt, NOW);

  it("同じ日・枠は、1つだけ", () => {
    insertFixture(21);
    expect(() => insertFixture(21)).toThrow(/UNIQUE/);
    expect(() => insertFixture(22)).not.toThrow();
  });

  it("時は 0〜23。状態は open / matched だけ", () => {
    expect(() => insertFixture(24)).toThrow(/CHECK/);
    expect(() => insertFixture(21, "closed")).toThrow(/CHECK/);
  });

  it("matched には処理した時刻が要り、open には要らない", () => {
    expect(() => insertFixture(21, "matched", null)).toThrow(/CHECK/);
    expect(() => insertFixture(22, "open", NOW)).toThrow(/CHECK/);
    expect(() => insertFixture(23, "matched", NOW)).not.toThrow();
  });

  it("open の対戦枠に、除外チームは入らない（処理済みになってから）", () => {
    const team = insertTeam("KMU", "r1");
    expect(() =>
      db.prepare("INSERT INTO match_slots (guild_id, slot_date, slot_hour, status, matched_at, excluded_team_id, created_at) VALUES (?, ?, ?, 'open', NULL, ?, ?)").run(GUILD, "2026-10-07", 21, team, NOW),
    ).toThrow(/CHECK/);
    expect(() =>
      db.prepare("INSERT INTO match_slots (guild_id, slot_date, slot_hour, status, matched_at, excluded_team_id, created_at) VALUES (?, ?, ?, 'matched', ?, ?, ?)").run(GUILD, "2026-10-07", 22, NOW, team, NOW),
    ).not.toThrow();
  });

  it("はじめは open", () => {
    expect(matchSlotId(21)).toBeGreaterThan(0);
    expect(db.prepare("SELECT status, matched_at FROM match_slots").get()).toMatchObject({ status: "open", matched_at: null });
  });
});

describe("teams", () => {
  it("同じサーバーで、同じロールを2つのチームに登録できない", () => {
    insertTeam("KMU", "r1");
    expect(() => insertTeam("UT", "r1")).toThrow(/UNIQUE/);
  });

  it("別のサーバーなら、同じロール ID でも登録できる", () => {
    insertTeam("KMU", "r1", "100");
    expect(() => insertTeam("KMU", "r1", "200")).not.toThrow();
  });
});

describe("slots", () => {
  const insertSlot = (hour: number) =>
    db.prepare("INSERT INTO slots (guild_id, hour, created_at) VALUES (?, ?, ?)").run(GUILD, hour, NOW);

  it("0〜23 の時だけ登録できる", () => {
    expect(() => insertSlot(23)).not.toThrow();
    expect(() => insertSlot(24)).toThrow(/CHECK/);
    expect(() => insertSlot(-1)).toThrow(/CHECK/);
  });

  it("同じ時を二重に登録できない", () => {
    insertSlot(21);
    expect(() => insertSlot(21)).toThrow(/UNIQUE/);
  });
});

describe("handups", () => {
  it("同じ枠・チームの挙手は1件だけ", () => {
    const team = insertTeam("KMU", "r1");
    insertHandup(team);
    expect(() => insertHandup(team)).toThrow(/UNIQUE/);
  });

  it("別の枠・別の日・別のチームなら挙手できる", () => {
    const a = insertTeam("KMU", "r1");
    const b = insertTeam("UT", "r2");
    insertHandup(a, 21);
    expect(() => insertHandup(a, 22)).not.toThrow();
    expect(() => insertHandup(a, 21, "2026-10-08")).not.toThrow();
    expect(() => insertHandup(b, 21)).not.toThrow();
  });

  it("取り消す（行を削除する）と、同じ枠に挙手し直せる。取り消した行は、残らない", () => {
    const team = insertTeam("KMU", "r1");
    insertHandup(team);
    db.prepare("DELETE FROM handups WHERE team_id = ?").run(team);
    expect(() => insertHandup(team)).not.toThrow();

    const rows = db.prepare("SELECT id FROM handups WHERE team_id = ?").all(team);
    expect(rows).toHaveLength(1);
  });

  it("存在しないチームでは挙手できない", () => {
    expect(() => insertHandup(999)).toThrow(/FOREIGN KEY/);
  });
});

describe("matches（組み合わせ）", () => {
  const insertMatch = (a: number, b: number, slot = 21) =>
    db.prepare("INSERT INTO matches (match_slot_id, team_a_id, team_b_id) VALUES (?, ?, ?)").run(matchSlotId(slot), a, b);

  it("同じチーム同士は組めない。存在しないチームは組めない", () => {
    const a = insertTeam("KMU", "r1");
    const b = insertTeam("UT", "r2");
    expect(() => insertMatch(a, b)).not.toThrow();
    expect(() => insertMatch(a, a, 22)).toThrow(/CHECK/);
    expect(() => insertMatch(a, 999, 23)).toThrow(/FOREIGN KEY/);
  });
});

/** 試合（組み合わせ）を1つ作って、その ID を返す */
function aMatch(): number {
  const a = insertTeam(`A${Math.random()}`, `ra${Math.random()}`);
  const b = insertTeam(`B${Math.random()}`, `rb${Math.random()}`);
  const result = db
    .prepare("INSERT INTO matches (match_slot_id, team_a_id, team_b_id) VALUES (?, ?, ?)")
    .run(matchSlotId(), a, b);
  return Number(result.lastInsertRowid);
}

describe("wins（勝利の記録）", () => {
  const insertWin = (fields: { teamId?: number | null; matchId?: number | null; points?: number | null; active?: number | null }) =>
    db
      .prepare(
        `INSERT INTO wins (guild_id, match_id, team_id, points, active, recorded_by, created_at)
         VALUES (?, ?, ?, ?, COALESCE(?, 1), ?, ?)`,
      )
      .run(GUILD, fields.matchId ?? null, fields.teamId ?? null, fields.points ?? null, fields.active ?? null, "admin-1", NOW);

  it("試合・チーム・生点がそろっていれば記録できる。はじめは有効", () => {
    const team = insertTeam("KMU", "r1");
    expect(() => insertWin({ teamId: team, matchId: aMatch(), points: 80 })).not.toThrow();
    expect(db.prepare("SELECT active FROM wins").get()).toEqual({ active: 1 });
  });

  it("試合・チーム・生点のどれが欠けても、記録できない", () => {
    const team = insertTeam("KMU", "r1");
    expect(() => insertWin({ teamId: team, matchId: aMatch() })).toThrow(/NOT NULL/);
    expect(() => insertWin({ matchId: aMatch(), points: 1 })).toThrow(/NOT NULL/);
    expect(() => insertWin({ teamId: team, points: 1 })).toThrow(/NOT NULL/);
  });

  it("存在しない試合・チームには、記録できない", () => {
    const team = insertTeam("KMU", "r1");
    expect(() => insertWin({ teamId: team, matchId: 999, points: 1 })).toThrow(/FOREIGN KEY/);
    expect(() => insertWin({ teamId: 999, matchId: aMatch(), points: 1 })).toThrow(/FOREIGN KEY/);
  });

  it("id は記録のたびに増える。無効にしても行は残る", () => {
    const team = insertTeam("KMU", "r1");
    const first = insertWin({ teamId: team, matchId: aMatch(), points: 1 });
    const second = insertWin({ teamId: team, matchId: aMatch(), points: 2 });
    expect(Number(second.lastInsertRowid)).toBeGreaterThan(Number(first.lastInsertRowid));

    db.prepare("UPDATE wins SET active = 0 WHERE id = ?").run(Number(first.lastInsertRowid));
    expect(db.prepare("SELECT COUNT(*) AS n FROM wins").get()).toEqual({ n: 2 });
  });
});

describe("dashboard_links", () => {
  const issue = (tokenHash: string, expiresAt: number) =>
    db
      .prepare(
        "INSERT INTO dashboard_links (token_hash, guild_id, issued_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(tokenHash, GUILD, "admin-1", expiresAt, NOW);

  // 本番のコードでリンクを消費するときに使う SQL。1回しか成功しないことを確かめる。
  const consume = (tokenHash: string, now: number) =>
    db
      .prepare(
        "UPDATE dashboard_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
      )
      .run(now, tokenHash, now);

  it("同じハッシュのリンクは発行できない", () => {
    issue("h1", NOW + 3_600_000);
    expect(() => issue("h1", NOW + 3_600_000)).toThrow(/UNIQUE/);
  });

  it("有効期限内なら、1回目だけ消費できる", () => {
    issue("h1", NOW + 3_600_000);
    expect(consume("h1", NOW + 1000).changes).toBe(1);
    expect(consume("h1", NOW + 2000).changes).toBe(0);
  });

  it("期限切れのリンクは消費できない", () => {
    issue("h1", NOW + 3_600_000);
    expect(consume("h1", NOW + 3_600_000).changes).toBe(0);
  });

  it("存在しないリンクは消費できない", () => {
    expect(consume("unknown", NOW).changes).toBe(0);
  });
});

describe("job_runs", () => {
  const insertJob = (jobKey: string, guildId = GUILD) =>
    db
      .prepare("INSERT INTO job_runs (guild_id, job_key, created_at) VALUES (?, ?, ?)")
      .run(guildId, jobKey, NOW);

  it("同じジョブは二重に実行済みにできない（cron の二重起動の防止）", () => {
    insertJob("cutoff:2026-10-07:21");
    expect(() => insertJob("cutoff:2026-10-07:21")).toThrow(/UNIQUE/);
  });

  it("別の枠・別のサーバーなら実行済みにできる", () => {
    insertJob("cutoff:2026-10-07:21");
    expect(() => insertJob("cutoff:2026-10-07:22")).not.toThrow();
    expect(() => insertJob("cutoff:2026-10-07:21", "200")).not.toThrow();
  });
});
