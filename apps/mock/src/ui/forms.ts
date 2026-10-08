import { ApplicationCommandOptionType, commands, type CommandDefinition } from "@uc/discord";
import { html } from "hono/html";
import type { MockRole } from "../state";
import { hourLabel } from "./format";

type OptionDefinition = NonNullable<CommandDefinition["options"]>[number];

type FormContext = {
  /** 登録されている試合枠の時刻（time の選択肢にする） */
  slots: number[];
  /** チームのロール（team-role の選択肢にする） */
  roles: MockRole[];
};

/** オプション1つ分の入力欄。名前と型に合わせて、選択・数値・日付・ファイルにする */
function renderField(option: OptionDefinition, context: FormContext) {
  const label = (control: unknown) => html`<label><span>${option.description}</span>${control}</label>`;

  if (option.type === ApplicationCommandOptionType.Role) {
    return label(html`<select name="${option.name}" ${option.required ? "required" : ""}>
      <option value="">${option.required ? "選択" : "（指定しない）"}</option>
      ${context.roles.map((role) => html`<option value="${role.name}">${role.name}</option>`)}
    </select>`);
  }

  if (option.type === ApplicationCommandOptionType.Integer && option.name === "time") {
    return label(
      context.slots.length > 0
        ? html`<select name="time" required>
            <option value="">選択</option>
            ${context.slots.map((hour) => html`<option value="${hour}">${hourLabel(hour)}</option>`)}
          </select>`
        : html`<input type="number" name="time" min="0" max="23" required />`,
    );
  }

  if (option.type === ApplicationCommandOptionType.Integer) {
    return label(
      html`<input type="number" name="${option.name}" step="1" ${option.min_value !== undefined ? html`min="${option.min_value}"` : ""} ${option.required ? "required" : ""} />`,
    );
  }

  if (option.type === ApplicationCommandOptionType.Attachment) {
    return label(
      html`<input type="file" name="${option.name}" accept="image/png,image/jpeg,image/webp,image/gif" ${option.required ? "required" : ""} />`,
    );
  }

  return label(
    option.name === "date"
      ? html`<input type="date" name="date" />`
      : html`<input type="text" name="${option.name}" ${option.required ? "required" : ""} />`,
  );
}

/**
 * コマンドの選択と、選んだコマンド1つ分のフォーム。
 * フォームは、コマンドの定義（@uc/discord）から作るので、コマンドやオプションを変えても追従する。
 * 実行するユーザーは、フォームの外（実行者の選択）で決める。
 */
export function renderCommands(context: FormContext) {
  return html`<div class="tabs" role="tablist">
      ${commands.map(
        (command, index) =>
          html`<button type="button" class="tab" role="tab" data-cmd="${command.name}" aria-selected="${index === 0 ? "true" : "false"}">/${command.name}${command.default_member_permissions ? html` <small>管理者</small>` : ""}</button>`,
      )}
    </div>
    ${commands.map(
      (command, index) => html`<form class="cmd" id="cmd-${command.name}" data-send method="post" action="/ui/send" enctype="multipart/form-data" ${index === 0 ? "" : "hidden"}>
        <input type="hidden" name="command" value="${command.name}" />
        ${(command.options ?? []).map((option) => renderField(option, context))}
        <button type="submit" class="primary wide" data-run>実行</button>
      </form>`,
    )}`;
}
