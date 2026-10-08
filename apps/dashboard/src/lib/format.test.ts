import { describe, expect, it } from "vitest";
import { formatHour, formatJstDateTime, todayJst } from "./format";

describe("format", () => {
  it("日時を JST の「月/日 時:分」にする（UTC の日付をまたいでも）", () => {
    expect(formatJstDateTime(Date.parse("2026-10-07T14:05:00+09:00"))).toBe("10/07 14:05");
    expect(formatJstDateTime(Date.parse("2026-10-07T15:30:00Z"))).toBe("10/08 00:30");
  });

  it("枠の時刻を、2桁の「HH:00」にする", () => {
    expect(formatHour(9)).toBe("09:00");
    expect(formatHour(21)).toBe("21:00");
  });

  it("今日の日付は、YYYY-MM-DD の形", () => {
    expect(todayJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
