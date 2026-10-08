import { Badge, Button, Group, Table, Text } from "@mantine/core";
import { Async, ConfirmButton, ErrorNote, Section } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatJstDateTime } from "../lib/format";
import { useInvalidatingMutation, useSessions } from "../lib/queries";

/** ログイン中の端末（誰が・いつログインして・いつまで有効か）の確認と、失効 */
export function Sessions() {
  const sessions = useSessions();
  const revoke = useInvalidatingMutation(
    (id: number) => unwrap(api.sessions[":id"].$delete({ param: { id: String(id) } })),
    [["sessions"], ["me"]],
  );
  const revokeAll = useInvalidatingMutation(() => unwrap(api.sessions["revoke-all"].$post()), [["sessions"], ["me"]]);

  return (
    <Section title="ログイン中の端末">
      <Text c="dimmed" size="sm">
        ログインは、リンクを使った時点から7日間有効です。心当たりのないログインは、失効させてください。
      </Text>
      <Async query={sessions}>
        {(data) => (
          <Table.ScrollContainer minWidth={640}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ユーザー</Table.Th>
                  <Table.Th>ログインした時刻</Table.Th>
                  <Table.Th>有効期限</Table.Th>
                  <Table.Th>ブラウザ</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.sessions.map((session) => (
                  <Table.Tr key={session.id}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        {session.userName}
                        {session.current && (
                          <Badge color="green" variant="light" tt="none">
                            このブラウザ
                          </Badge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{formatJstDateTime(session.createdAt)}</Table.Td>
                    <Table.Td>{formatJstDateTime(session.expiresAt)}</Table.Td>
                    <Table.Td c="dimmed" maw={260} style={{ whiteSpace: "normal" }}>
                      {session.userAgent ?? "—"}
                    </Table.Td>
                    <Table.Td>
                      <Button variant="default" disabled={revoke.isPending} onClick={() => revoke.mutate(session.id)} aria-label={`${session.userName}のログインを失効させる`}>
                        失効させる
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Async>
      <Group>
        <ConfirmButton
          label="すべてのログインを失効させる"
          confirmLabel="すべて失効させる"
          heavy
          description="すべての端末のログインを失効させます。いま使っているブラウザも、ログアウトされます。"
          danger
          disabled={revokeAll.isPending}
          onConfirm={() => revokeAll.mutate(undefined)}
        />
        <Text c="dimmed" size="sm">
          いま使っているブラウザも、ログアウトされます。
        </Text>
      </Group>
      <ErrorNote error={revoke.error ?? revokeAll.error} />
    </Section>
  );
}
