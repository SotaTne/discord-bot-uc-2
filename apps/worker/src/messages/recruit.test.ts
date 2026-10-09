import { describe, expect, it } from "vitest";
import { recruitMention, recruitMessage } from "./recruit";

const teams = [{ roleId: "111111111111111111" }, { roleId: "222222222222222222" }, { roleId: "111111111111111111" }];

describe("recruitMention（設定から、通知先を決める）", () => {
  it("none: 誰にも通知しない", () => {
    expect(recruitMention({ recruitMentionMode: "none", recruitMentionTargets: ["here"] }, teams)).toEqual({ text: "", roleIds: [], here: false });
  });

  it("teams: 登録済みのチームのロール全部（重なりは、1 つにする）。選んだ通知先は、使わない", () => {
    expect(recruitMention({ recruitMentionMode: "teams", recruitMentionTargets: ["here"] }, teams)).toEqual({
      text: "<@&111111111111111111> <@&222222222222222222>",
      roleIds: ["111111111111111111", "222222222222222222"],
      here: false,
    });
  });

  it("roles: 選んだロールと、@here。@here は、先頭。チームのロールは、使わない", () => {
    expect(recruitMention({ recruitMentionMode: "roles", recruitMentionTargets: ["333333333333333333", "here"] }, teams)).toEqual({
      text: "@here <@&333333333333333333>",
      roleIds: ["333333333333333333"],
      here: true,
    });
    expect(recruitMention({ recruitMentionMode: "roles", recruitMentionTargets: [] }, teams)).toEqual({ text: "", roleIds: [], here: false });
  });
});

describe("recruitMessage", () => {
  it("募集開始の時刻を入れる。通知先があれば、先頭の行に、メンションを出す", () => {
    expect(recruitMessage(12)).toBe("# 12:00になりましたので、本日の募集を開始します");
    expect(recruitMessage(12, { text: "@here", roleIds: [], here: true })).toBe("@here\n# 12:00になりましたので、本日の募集を開始します");
  });
});
