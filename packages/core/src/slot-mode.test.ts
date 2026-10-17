import { describe, expect, it } from "vitest";
import { slotOperations } from "./slot-mode";

const jst = (text: string) => new Date(`${text}+09:00`);
const at = (now: string, matched: boolean) => slotOperations({ now: jst(now), slotDate: "2026-10-07", slotHour: 21, matched });

describe("slotOperations（対戦枠への、管理者の操作の可否）", () => {
  it("未マッチングで、試合開始前なら、運営モード: マッチング処理を実行できる。やり直し・通知の選択は、ない", () => {
    expect(at("2026-10-07T15:00:00", false)).toEqual({ mode: "operate", canRunMatching: true, canReopen: false, canNotifyEdit: false });
  });

  it("未マッチングのまま締切を過ぎても（cron の失敗・やり直しのあと）、試合開始までは、運営モード", () => {
    expect(at("2026-10-07T20:55:00", false)).toMatchObject({ mode: "operate", canRunMatching: true });
    expect(at("2026-10-07T20:59:59", false)).toMatchObject({ mode: "operate", canRunMatching: true });
  });

  it("マッチング済みで、試合開始前なら、補正モード: マッチング処理はできない。やり直しと、通知の選択ができる", () => {
    expect(at("2026-10-07T20:55:00", true)).toEqual({ mode: "correct", canRunMatching: false, canReopen: true, canNotifyEdit: true });
  });

  it("締切より前に、手動でマッチングを済ませた場合も、補正モード", () => {
    expect(at("2026-10-07T15:00:00", true)).toMatchObject({ mode: "correct", canRunMatching: false, canReopen: true });
  });

  it("試合開始の時刻ちょうどから、補正モード。マッチング処理・やり直し・通知の選択は、すべて、できない", () => {
    for (const matched of [true, false]) {
      expect(at("2026-10-07T21:00:00", matched)).toEqual({ mode: "correct", canRunMatching: false, canReopen: false, canNotifyEdit: false });
    }
  });

  it("過去の日の対戦枠は、補正モード（マッチング済みでなくても）", () => {
    expect(slotOperations({ now: jst("2026-10-08T09:00:00"), slotDate: "2026-10-07", slotHour: 21, matched: false })).toMatchObject({
      mode: "correct",
      canRunMatching: false,
    });
  });

  it("まだ来ていない日の対戦枠は、運営モード", () => {
    expect(slotOperations({ now: jst("2026-10-07T09:00:00"), slotDate: "2026-10-08", slotHour: 21, matched: false })).toMatchObject({
      mode: "operate",
      canRunMatching: true,
    });
  });
});
