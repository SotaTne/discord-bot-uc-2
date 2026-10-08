import { describe, expect, it } from "vitest";
import {
  formatJstTime,
  handupDeadline,
  handupPhase,
  isAcceptingHandups,
  jstDateOf,
  resolveRecentSlotDate,
  slotPhase,
  slotStart,
} from "./slot-time";

const jst = (text: string) => new Date(`${text}+09:00`);

describe("jstDateOf", () => {
  it("UTC では前日でも、JST の日付で返す", () => {
    // 2026-10-07T15:30Z は JST では 2026-10-08 00:30
    expect(jstDateOf(new Date("2026-10-07T15:30:00Z"))).toBe("2026-10-08");
  });
});

describe("slotStart / handupDeadline", () => {
  it("JST の日付と時から開始時刻を作る", () => {
    expect(slotStart("2026-10-07", 21).toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("試合開始の K 分前を返す", () => {
    expect(handupDeadline("2026-10-07", 21, 7).toISOString()).toBe("2026-10-07T11:53:00.000Z");
  });

  it("0〜23 以外の時は拒否する", () => {
    expect(() => slotStart("2026-10-07", 24)).toThrow(RangeError);
    expect(() => slotStart("2026-10-07", 1.5)).toThrow(RangeError);
  });
});

describe("resolveRecentSlotDate", () => {
  it("今日の対戦枠がもう始まっていれば今日", () => {
    expect(resolveRecentSlotDate(jst("2026-10-07T22:30:00"), 21)).toBe("2026-10-07");
  });

  it("対戦枠の開始ちょうどは、その日として扱う", () => {
    expect(resolveRecentSlotDate(jst("2026-10-07T21:00:00"), 21)).toBe("2026-10-07");
  });

  it("今日の対戦枠がまだなら、前日", () => {
    expect(resolveRecentSlotDate(jst("2026-10-07T22:30:00"), 23)).toBe("2026-10-06");
  });

  it("日付が変わった後でも、前日の遅い対戦枠を指せる", () => {
    expect(resolveRecentSlotDate(jst("2026-10-08T00:30:00"), 23)).toBe("2026-10-07");
  });

  it("月をまたいでも前日を返す", () => {
    expect(resolveRecentSlotDate(jst("2026-11-01T10:00:00"), 21)).toBe("2026-10-31");
  });
});

describe("isAcceptingHandups", () => {
  const window = { recruitHour: 12, cutoffMinutes: 7 };

  it("募集開始より前は受け付けない", () => {
    expect(isAcceptingHandups(jst("2026-10-07T11:59:59"), 21, window)).toBe(false);
  });

  it("募集開始ちょうどから受け付ける", () => {
    expect(isAcceptingHandups(jst("2026-10-07T12:00:00"), 21, window)).toBe(true);
  });

  it("試合開始の7分前の直前まで受け付ける", () => {
    expect(isAcceptingHandups(jst("2026-10-07T20:52:59"), 21, window)).toBe(true);
  });

  it("試合開始の7分前ちょうどで打ち切る", () => {
    expect(isAcceptingHandups(jst("2026-10-07T20:53:00"), 21, window)).toBe(false);
  });

  it("対戦枠ごとに打ち切り時刻が違う", () => {
    const now = jst("2026-10-07T21:30:00");
    expect(isAcceptingHandups(now, 21, window)).toBe(false);
    expect(isAcceptingHandups(now, 22, window)).toBe(true);
  });

  it("打ち切り分数を設定で変えられる", () => {
    expect(isAcceptingHandups(jst("2026-10-07T20:40:00"), 21, { recruitHour: 12, cutoffMinutes: 30 })).toBe(false);
  });
});

describe("handupPhase", () => {
  const window = { recruitHour: 12, cutoffMinutes: 7 };

  it("募集開始前・受付中・締切後の3段階を返す", () => {
    expect(handupPhase(jst("2026-10-07T11:59:59"), 21, window)).toBe("before-open");
    expect(handupPhase(jst("2026-10-07T12:00:00"), 21, window)).toBe("open");
    expect(handupPhase(jst("2026-10-07T20:52:59"), 21, window)).toBe("open");
    expect(handupPhase(jst("2026-10-07T20:53:00"), 21, window)).toBe("closed");
    expect(handupPhase(jst("2026-10-07T23:30:00"), 21, window)).toBe("closed");
  });

  it("日付が変わると、また募集開始前になる", () => {
    expect(handupPhase(jst("2026-10-08T00:10:00"), 21, window)).toBe("before-open");
  });

  it("isAcceptingHandups は、受付中のときだけ true", () => {
    expect(isAcceptingHandups(jst("2026-10-07T15:00:00"), 21, window)).toBe(true);
    expect(isAcceptingHandups(jst("2026-10-07T11:00:00"), 21, window)).toBe(false);
    expect(isAcceptingHandups(jst("2026-10-07T21:00:00"), 21, window)).toBe(false);
  });
});

describe("slotPhase（日付を指定した、受付の段階）", () => {
  const window = { recruitHour: 12, cutoffMinutes: 7 };
  const now = jst("2026-10-07T15:00:00");

  it("その日の対戦枠は、handupPhase と同じ", () => {
    expect(slotPhase(now, "2026-10-07", 21, window)).toBe("open");
    expect(slotPhase(jst("2026-10-07T21:00:00"), "2026-10-07", 21, window)).toBe("closed");
  });

  it("過去の日の対戦枠は、いつも締切後。未来の日の対戦枠は、いつも募集開始前", () => {
    expect(slotPhase(now, "2026-10-06", 21, window)).toBe("closed");
    expect(slotPhase(now, "2026-10-08", 21, window)).toBe("before-open");
    expect(slotPhase(jst("2026-10-07T23:59:00"), "2026-10-08", 21, window)).toBe("before-open");
  });
});

describe("formatJstTime", () => {
  it("JST の HH:MM で表す（UTC の日付をまたぐ場合も）", () => {
    expect(formatJstTime(jst("2026-10-07T14:05:30"))).toBe("14:05");
    expect(formatJstTime(new Date("2026-10-07T15:30:00Z"))).toBe("00:30");
  });
});
