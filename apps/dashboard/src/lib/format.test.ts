import { describe, expect, it } from "vitest";
import { describeBrowser, formatHour, formatJstDateTime, formatJstNow, todayJst } from "./format";

describe("format", () => {
  it("日時を JST の「月/日 時:分」にする（UTC の日付をまたいでも）", () => {
    expect(formatJstDateTime(Date.parse("2026-10-07T14:05:00+09:00"))).toBe("10/07 14:05");
    expect(formatJstDateTime(Date.parse("2026-10-07T15:30:00Z"))).toBe("10/08 00:30");
  });

  it("対戦枠の時刻を、2桁の「HH:00」にする", () => {
    expect(formatHour(9)).toBe("09:00");
    expect(formatHour(21)).toBe("21:00");
  });

  it("今日の日付は、YYYY-MM-DD の形", () => {
    expect(todayJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("いまの日時を、「月/日（曜日） 時:分」にする（UTC の日付をまたいでも JST）", () => {
    expect(formatJstNow(new Date("2026-10-07T15:00:00+09:00"))).toBe("10/07（水） 15:00");
    expect(formatJstNow(new Date("2026-10-07T15:30:00Z"))).toBe("10/08（木） 00:30");
  });

  it("User-Agent を、ブラウザと OS だけの短い表示にする", () => {
    const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15";
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    const edge = `${chrome} Edg/130.0.0.0`;
    const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

    expect(describeBrowser(safari)).toBe("Safari・macOS");
    expect(describeBrowser(chrome)).toBe("Chrome・Windows");
    expect(describeBrowser(edge)).toBe("Edge・Windows");
    expect(describeBrowser(firefox)).toBe("Firefox・Linux");
    expect(describeBrowser(iphone)).toBe("Safari・iOS");
    expect(describeBrowser(android)).toBe("Chrome・Android");
  });

  it("読み取れない User-Agent は「不明なブラウザ」、ないときは「—」", () => {
    expect(describeBrowser("curl/8.0")).toBe("不明なブラウザ");
    expect(describeBrowser(null)).toBe("—");
    expect(describeBrowser("")).toBe("—");
  });
});
