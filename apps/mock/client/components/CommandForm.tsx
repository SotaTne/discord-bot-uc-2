import { Button, NativeSelect, Stack, TextInput } from "@mantine/core";
import { ApplicationCommandOptionType, commands, type CommandDefinition } from "@uc/discord";
import { useState, type FormEvent } from "react";
import { formOf, useAction } from "../actions";
import { mockApi } from "../api";
import type { MockStateData } from "../mockState";
import { hourLabel } from "../time";

type Option = NonNullable<CommandDefinition["options"]>[number];

/** オプション 1 つ分の入力欄。名前と型に合わせて、選択・数値・日付・ファイルにする */
function Field({ option, state }: { option: Option; state: MockStateData }) {
  const label = option.description;
  const required = option.required === true;
  const slotHours = state.snapshot?.slotHours ?? [21, 22, 23];

  if (option.type === ApplicationCommandOptionType.Role) {
    return (
      <NativeSelect
        label={label}
        name={option.name}
        required={required}
        data={[{ value: "", label: required ? "選択" : "（指定しない）" }, ...state.roles.map((role) => ({ value: role.name, label: role.name }))]}
      />
    );
  }
  if (option.type === ApplicationCommandOptionType.Integer && option.name === "time") {
    return <NativeSelect label={label} name="time" required data={[{ value: "", label: "選択" }, ...slotHours.map((hour) => ({ value: String(hour), label: hourLabel(hour) }))]} />;
  }
  if (option.type === ApplicationCommandOptionType.Integer) {
    return <TextInput label={label} name={option.name} type="number" step={1} required={required} {...(option.min_value !== undefined ? { min: option.min_value } : {})} {...(option.max_value !== undefined ? { max: option.max_value } : {})} />;
  }
  return option.name === "date" ? <TextInput label={label} name="date" type="date" /> : <TextInput label={label} name={option.name} required={required} />;
}

/**
 * コマンドの選択と、選んだコマンド 1 つ分のフォーム。
 * フォームは、コマンドの定義（@uc/discord）から作るので、コマンドやオプションを変えても追従する。
 * 実行するユーザーは、フォームの外（実行者の選択）で決める。
 */
export function CommandForm({ state, selectedUsers }: { state: MockStateData; selectedUsers: string[] }) {
  const [current, setCurrent] = useState(commands[0]?.name ?? "");
  const definition = commands.find((command) => command.name === current);
  const send = useAction((form) => mockApi.send.$post({}, { init: { body: form } }));
  const names = selectedUsers.map((id) => state.users.find((user) => user.id === id)?.username ?? id);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedUsers.length === 0) return;
    const form = new FormData(event.currentTarget);
    form.set("command", current);
    form.set("users", selectedUsers.join(","));
    send.mutate(form, { onSuccess: () => undefined });
  }

  return (
    <div className="command-pane">
      <div className="command-list" role="tablist" aria-orientation="vertical" aria-label="コマンド">
        {commands.map((command) => (
          <button key={command.name} type="button" className="command" role="tab" aria-selected={command.name === current} title={command.description} onClick={() => setCurrent(command.name)}>
            <span className="name">/{command.name}</span>
            <span className="desc">{command.description.replace(/^\(管理者のみ\)\s*/, "")}</span>
            {command.default_member_permissions ? <span className="admin">管理者</span> : null}
          </button>
        ))}
      </div>
      {definition && (
        // コマンドを切り替えたら、入力を、いったん、空にする（key で、作り直す）
        <form key={definition.name} aria-label={`/${definition.name}`} onSubmit={submit}>
          <Stack gap="sm">
            {(definition.options ?? []).map((option) => (
              <Field key={option.name} option={option} state={state} />
            ))}
            <Button type="submit" fullWidth disabled={selectedUsers.length === 0 || send.isPending}>
              {selectedUsers.length === 0 ? "実行者を選んでください" : `${names.join("・")} で実行`}
            </Button>
          </Stack>
        </form>
      )}
    </div>
  );
}

export { formOf };
