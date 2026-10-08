import { describe, expect, it } from "vitest";
import { getIntegerOption, getStringOption } from "./options";
import type { CommandOptionValue, Interaction } from "./types";

const interaction = (options?: CommandOptionValue[]): Interaction => ({
  id: "1",
  application_id: "1",
  type: 2,
  token: "t",
  data: options ? { name: "x", options } : { name: "x" },
});

describe("getIntegerOption", () => {
  it("整数のオプションを取り出す", () => {
    expect(getIntegerOption(interaction([{ name: "time", type: 4, value: 21 }]), "time")).toBe(21);
  });

  it("指定がない・オプション自体がないときは null", () => {
    expect(getIntegerOption(interaction([]), "time")).toBeNull();
    expect(getIntegerOption(interaction(), "time")).toBeNull();
  });

  it("型が整数でない・値が小数なら null", () => {
    expect(getIntegerOption(interaction([{ name: "time", type: 3, value: "21" }]), "time")).toBeNull();
    expect(getIntegerOption(interaction([{ name: "time", type: 4, value: 21.5 }]), "time")).toBeNull();
  });
});

describe("getStringOption", () => {
  it("文字列（ロール ID など）を取り出す", () => {
    expect(getStringOption(interaction([{ name: "team-role", type: 8, value: "123" }]), "team-role")).toBe("123");
  });

  it("指定がない・文字列でないときは null", () => {
    expect(getStringOption(interaction([]), "team-role")).toBeNull();
    expect(getStringOption(interaction([{ name: "time", type: 4, value: 21 }]), "time")).toBeNull();
  });
});
