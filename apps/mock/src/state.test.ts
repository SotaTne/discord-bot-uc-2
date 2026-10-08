import { beforeEach, describe, expect, it } from "vitest";
import { defaultSeed } from "./seed";
import { createMockState, type MockState } from "./state";

let state: MockState;
const alice = () => state.users[0]!;
const carol = () => state.users[2]!;

beforeEach(() => {
  state = createMockState(defaultSeed());
});

describe("MockState", () => {
  it("ID は呼ぶたびに別の値になる", () => {
    const ids = new Set([state.newId(), state.newId(), state.newId()]);
    expect(ids.size).toBe(3);
  });

  it("ロールを名前でも ID でも引ける", () => {
    const kmu = state.findRole("KMU");
    expect(kmu).toBeDefined();
    expect(state.findRole(kmu!.id)).toBe(kmu);
    expect(state.findRole("存在しない")).toBeUndefined();
  });

  it("公開メッセージは全員に、ephemeral は宛先のユーザーにだけ見える", () => {
    state.addMessage({ channelId: state.channelId, content: "公開" });
    state.addMessage({ channelId: state.channelId, content: "aliceだけ", visibleTo: alice().id });

    expect(state.messagesVisibleTo(alice().id).map((m) => m.content)).toEqual(["公開", "aliceだけ"]);
    expect(state.messagesVisibleTo(carol().id).map((m) => m.content)).toEqual(["公開"]);
  });

  it("reset でメッセージと保留中のインタラクションが消える", () => {
    state.addMessage({ channelId: state.channelId, content: "x" });
    state.markPending("t1", { userId: alice().id, channelId: state.channelId, ephemeral: true });

    state.reset();

    expect(state.messages).toHaveLength(0);
    expect(state.getPending("t1")).toBeUndefined();
  });
});
