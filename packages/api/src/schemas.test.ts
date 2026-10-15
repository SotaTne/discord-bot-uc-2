import { describe, expect, it } from "vitest";
import {
  adminHandupInputSchema,
  dateQuerySchema,
  dateSchema,
  hourSchema,
  loginInputSchema,
  settingsInputSchema,
  snowflakeSchema,
  teamInputSchema,
  matchInputSchema,
} from "./schemas";

describe("hourSchema", () => {
  it("0〜23 の整数だけ通す", () => {
    expect(hourSchema.safeParse(0).success).toBe(true);
    expect(hourSchema.safeParse(23).success).toBe(true);
    expect(hourSchema.safeParse(24).success).toBe(false);
    expect(hourSchema.safeParse(-1).success).toBe(false);
    expect(hourSchema.safeParse(21.5).success).toBe(false);
    expect(hourSchema.safeParse("21").success).toBe(false);
  });
});

describe("dateSchema", () => {
  it("実在する YYYY-MM-DD だけ通す", () => {
    expect(dateSchema.safeParse("2026-10-07").success).toBe(true);
    expect(dateSchema.safeParse("2028-02-29").success).toBe(true);
  });

  it("形式が違う・存在しない日付は拒否する", () => {
    expect(dateSchema.safeParse("2026/10/07").success).toBe(false);
    expect(dateSchema.safeParse("2026-1-7").success).toBe(false);
    expect(dateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(dateSchema.safeParse("2027-02-29").success).toBe(false);
    expect(dateSchema.safeParse("2026-13-01").success).toBe(false);
  });
});

describe("snowflakeSchema", () => {
  it("数字だけの ID を通す", () => {
    expect(snowflakeSchema.safeParse("1234567890123456789").success).toBe(true);
  });

  it("数字以外や短すぎる値は拒否する", () => {
    expect(snowflakeSchema.safeParse("abc").success).toBe(false);
    expect(snowflakeSchema.safeParse("123").success).toBe(false);
    expect(snowflakeSchema.safeParse("123456789012345a").success).toBe(false);
  });
});

describe("teamInputSchema", () => {
  it("ロールの ID だけで決まる（名前は、持たない）", () => {
    expect(teamInputSchema.parse({ roleId: "1234567890123456789" })).toEqual({ roleId: "1234567890123456789" });
  });

  it("ロールの ID がない・不正なら拒否する", () => {
    expect(teamInputSchema.safeParse({}).success).toBe(false);
    expect(teamInputSchema.safeParse({ roleId: "abc" }).success).toBe(false);
  });
});

describe("matchInputSchema（組分けの追加）", () => {
  it("2チーム・対戦枠の時刻があれば、通る。日付は省略できる", () => {
    expect(matchInputSchema.safeParse({ teamAId: 1, teamBId: 2, slotHour: 21 }).success).toBe(true);
    expect(matchInputSchema.safeParse({ teamAId: 1, teamBId: 2, slotHour: 21, slotDate: "2026-10-07" }).success).toBe(true);
  });

  it("同じチーム同士・不正なチーム・時刻・日付は拒否する", () => {
    expect(matchInputSchema.safeParse({ teamAId: 1, teamBId: 1, slotHour: 21 }).success).toBe(false);
    expect(matchInputSchema.safeParse({ teamAId: 0, teamBId: 2, slotHour: 21 }).success).toBe(false);
    expect(matchInputSchema.safeParse({ teamAId: 1, teamBId: 2, slotHour: 24 }).success).toBe(false);
    expect(matchInputSchema.safeParse({ teamAId: 1, teamBId: 2, slotHour: 21, slotDate: "2026-02-30" }).success).toBe(false);
  });
});

describe("settingsInputSchema", () => {
  const valid = {
    channelId: "1234567890123456789",
    recruitHour: 12,
    cutoffMinutes: 7,
    recruitMentionMode: "none",
    recruitMentionTargets: [],
    revokeSessionsOnReissue: false,
  };

  it("正しい設定を通す。チャンネルは未設定（null）でもよい", () => {
    expect(settingsInputSchema.safeParse(valid).success).toBe(true);
    expect(settingsInputSchema.safeParse({ ...valid, channelId: null }).success).toBe(true);
  });

  it("募集開始の通知先: 既定は、誰にも通知しない（空）。ロールの ID と @here を、選べる。重なり・形の違う値は、拒否する", () => {
    const roles = { ...valid, recruitMentionMode: "roles" };
    expect(settingsInputSchema.safeParse({ ...roles, recruitMentionTargets: ["1234567890123456789", "here"] }).success).toBe(true);
    expect(settingsInputSchema.safeParse({ ...valid, recruitMentionMode: "teams" }).success).toBe(true);

    expect(settingsInputSchema.safeParse({ ...roles, recruitMentionTargets: ["here", "here"] }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...roles, recruitMentionTargets: ["everyone"] }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...roles, recruitMentionTargets: ["12"] }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...valid, recruitMentionMode: "all" }).success).toBe(false);
  });

  it("締切の分数が 0 や大きすぎる値は拒否する", () => {
    expect(settingsInputSchema.safeParse({ ...valid, cutoffMinutes: 0 }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ ...valid, cutoffMinutes: 181 }).success).toBe(false);
  });
});

describe("loginInputSchema", () => {
  it("短すぎるトークンは拒否する", () => {
    expect(loginInputSchema.safeParse({ token: "short" }).success).toBe(false);
    expect(loginInputSchema.safeParse({ token: "a".repeat(43) }).success).toBe(true);
  });
});

describe("adminHandupInputSchema", () => {
  it("日付は省略できる。時が範囲外なら拒否する", () => {
    expect(adminHandupInputSchema.safeParse({ teamId: 1, slotHour: 21 }).success).toBe(true);
    expect(adminHandupInputSchema.safeParse({ teamId: 1, slotHour: 24 }).success).toBe(false);
    expect(adminHandupInputSchema.safeParse({ teamId: 0, slotHour: 21 }).success).toBe(false);
  });
});

describe("dateQuerySchema", () => {
  it("日付は省略できる。形式が違えば拒否する", () => {
    expect(dateQuerySchema.safeParse({}).success).toBe(true);
    expect(dateQuerySchema.safeParse({ date: "2026-10-07" }).success).toBe(true);
    expect(dateQuerySchema.safeParse({ date: "10/07" }).success).toBe(false);
  });
});
