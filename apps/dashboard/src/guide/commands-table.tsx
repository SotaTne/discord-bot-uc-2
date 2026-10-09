import { Badge, Group, Table } from "@mantine/core";
import { commands, type CommandDefinition } from "@uc/discord/commands";

/** コマンドの書き方（例: `/uc-handup time`）。必須でないオプションは [ ] で囲む */
export function signature(command: CommandDefinition): string {
  const options = (command.options ?? []).map((option) => (option.required ? option.name : `[${option.name}]`));
  return ["/" + command.name, ...options].join(" ");
}

/** 管理者のコマンドの説明には「(管理者のみ) 」が付いているので、バッジで示して、文からは外す */
export function plainDescription(command: CommandDefinition): string {
  return command.description.replace(/^\(管理者のみ\)\s*/, "");
}

/** Discord に登録するコマンドの一覧（コマンド定義から作るので、ガイドと実際のコマンドがずれない） */
export function CommandsTable() {
  return (
    <Table aria-label="コマンド一覧">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>コマンド</Table.Th>
          <Table.Th>できること</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {commands.map((command) => (
          <Table.Tr key={command.name}>
            <Table.Td style={{ whiteSpace: "nowrap" }}>
              <code>{signature(command)}</code>
            </Table.Td>
            <Table.Td>
              <Group gap="xs" wrap="nowrap" align="baseline">
                {command.default_member_permissions !== undefined && (
                  <Badge variant="light" color="gray" style={{ flexShrink: 0 }}>
                    管理者のみ
                  </Badge>
                )}
                <span>{plainDescription(command)}</span>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
