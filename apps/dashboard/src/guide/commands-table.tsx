import { Badge, Group, Stack, Table, Text } from "@mantine/core";
import { CommandOptionType, commands, type CommandDefinition, type CommandOption } from "@uc/discord/commands";

const TYPE_LABEL: Record<number, string> = {
  [CommandOptionType.String]: "文字列",
  [CommandOptionType.Integer]: "整数",
  [CommandOptionType.Role]: "ロール",
  [CommandOptionType.Attachment]: "画像（添付）",
};

/** コマンドの書き方（例: `/uc-handup time`）。必須でないオプションは [ ] で囲む */
export function signature(command: CommandDefinition): string {
  const options = (command.options ?? []).map((option) => (option.required ? option.name : `[${option.name}]`));
  return ["/" + command.name, ...options].join(" ");
}

/** 管理者のコマンドの説明には「(管理者のみ) 」が付いているので、バッジで示して、文からは外す */
export function plainDescription(command: CommandDefinition): string {
  return command.description.replace(/^\(管理者のみ\)\s*/, "");
}

/** 値の範囲（例: 0〜23） */
function rangeOf(option: CommandOption): string {
  if (option.min_value === undefined || option.max_value === undefined) return "";
  return `${option.min_value}〜${option.max_value}`;
}

function Options({ command }: { command: CommandDefinition }) {
  if (!command.options?.length) return <Text size="sm" c="dimmed">引数はない</Text>;
  return (
    <Table aria-label={`/${command.name} の引数`}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>引数</Table.Th>
          <Table.Th>型</Table.Th>
          <Table.Th>必須</Table.Th>
          <Table.Th>内容</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {command.options.map((option) => (
          <Table.Tr key={option.name}>
            <Table.Td style={{ whiteSpace: "nowrap" }}>
              <code>{option.name}</code>
            </Table.Td>
            <Table.Td style={{ whiteSpace: "nowrap" }}>{TYPE_LABEL[option.type] ?? "不明"}</Table.Td>
            <Table.Td style={{ whiteSpace: "nowrap" }}>{option.required ? "必須" : "省略できる"}</Table.Td>
            <Table.Td>
              {option.description}
              {rangeOf(option) && <Text span c="dimmed">（{rangeOf(option)}）</Text>}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** Discord に登録するコマンドの一覧（コマンド定義から作るので、ガイドと実際のコマンドがずれない）。コマンドごとに、書き方・説明・引数の表を出す */
export function CommandsTable() {
  return (
    <Stack gap="lg" role="list" aria-label="コマンド一覧" className="command-list">
      {commands.map((command) => (
        <div key={command.name} role="listitem">
          <Group gap="xs" align="baseline">
            <code>{signature(command)}</code>
            {command.default_member_permissions !== undefined && (
              <Badge variant="light" color="gray">
                管理者のみ
              </Badge>
            )}
          </Group>
          <Text size="sm" my={4}>
            {plainDescription(command)}
          </Text>
          <Options command={command} />
        </div>
      ))}
    </Stack>
  );
}
