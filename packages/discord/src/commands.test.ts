import { describe, expect, it } from "vitest";
import { commands } from "./commands";
import { confirmMessage, deferEphemeral, ephemeralMessage, pong, updateMessage } from "./responses";
import { MessageFlags, hasAdministrator } from "./types";

describe("commands（Discord のコマンド登録の決まり）", () => {
  it("コマンド名は重複しない", () => {
    const names = commands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("名前は小文字・数字・ハイフンで32文字以内、説明は100文字以内", () => {
    for (const command of commands) {
      expect(command.name, command.name).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(command.description.length, command.name).toBeLessThanOrEqual(100);
      for (const option of command.options ?? []) {
        expect(option.name, `${command.name}.${option.name}`).toMatch(/^[a-z0-9-]{1,32}$/);
        expect(option.description.length, `${command.name}.${option.name}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("必須のオプションは、任意のオプションより前にある", () => {
    for (const command of commands) {
      const required = (command.options ?? []).map((o) => o.required === true);
      const firstOptional = required.indexOf(false);
      if (firstOptional !== -1) {
        expect(required.slice(firstOptional), command.name).not.toContain(true);
      }
    }
  });

  it("uc-admin-* は管理者のみ（Administrator）に設定されている", () => {
    for (const command of commands.filter((c) => c.name.startsWith("uc-admin-"))) {
      expect(command.default_member_permissions, command.name).toBe("8");
    }
  });

  it("すべてのコマンドがサーバー内専用（DM では使えない）", () => {
    for (const command of commands) {
      expect(command.dm_permission, command.name).toBe(false);
    }
  });

  it("SPEC.md のコマンドがそろっている", () => {
    expect(commands.map((c) => c.name).sort()).toEqual(
      [
        "uc-admin-dashboard",
        "uc-admin-role",
        "uc-admin-status",
        "uc-handdown",
        "uc-handup",
        "uc-status",
        "uc-teams",
      ].sort(),
    );
  });
});

describe("responses", () => {
  it("ephemeralMessage は本人にだけ見え、メンションで通知しない", () => {
    const response = ephemeralMessage("<@&1> 21時の試合に挙手しました");
    expect(response.data?.flags).toBe(MessageFlags.Ephemeral);
    expect(response.data?.allowed_mentions).toEqual({ parse: [] });
  });

  it("suppressEmbeds を指定すると、URL のプレビューも出さない（Ephemeral + SuppressEmbeds）", () => {
    expect(ephemeralMessage("https://example.com", { suppressEmbeds: true }).data?.flags).toBe(64 | 4);
    expect(ephemeralMessage("x").data?.flags).toBe(64);
  });

  it("confirmMessage は、実行とキャンセルのボタンつきで、本人にだけ見える", () => {
    const response = confirmMessage({ content: "消しますか", confirmId: "a:confirm", confirmLabel: "消す", cancelId: "a:cancel" });
    expect(response.data?.flags).toBe(64);
    expect(response.data?.components?.[0]?.components.map((b) => [b.label, b.custom_id, b.style])).toEqual([
      ["消す", "a:confirm", 4],
      ["キャンセル", "a:cancel", 2],
    ]);
  });

  it("updateMessage はメッセージを置き換え、ボタンを消す", () => {
    expect(updateMessage("完了")).toEqual({
      type: 7,
      data: { content: "完了", components: [], allowed_mentions: { parse: [] } },
    });
  });

  it("deferEphemeral は ephemeral の「考え中」を返す", () => {
    expect(deferEphemeral()).toEqual({ type: 5, data: { flags: 64 } });
  });

  it("pong は type 1", () => {
    expect(pong()).toEqual({ type: 1 });
  });
});

describe("hasAdministrator", () => {
  it("Administrator のビットがあれば true", () => {
    expect(hasAdministrator("8")).toBe(true);
    expect(hasAdministrator("2147483647")).toBe(true);
  });

  it("なければ false。不正な値や未指定も false", () => {
    expect(hasAdministrator("0")).toBe(false);
    expect(hasAdministrator("2048")).toBe(false);
    expect(hasAdministrator("abc")).toBe(false);
    expect(hasAdministrator(undefined)).toBe(false);
  });
});
