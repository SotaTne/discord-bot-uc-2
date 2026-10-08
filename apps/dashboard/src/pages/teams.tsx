import { Badge, Button, Group, NativeSelect, Table, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import { Async, ConfirmButton, ErrorNote, Section } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { useInvalidatingMutation, useRoles, useScores, useTeams } from "../lib/queries";

/** チームごとの得点と成績。チームの追加と削除（チームは、Discord のロール） */
export function TeamsPage() {
  return (
    <>
      <Scoreboard />
      <Teams />
    </>
  );
}

function Scoreboard() {
  const scores = useScores();
  return (
    <Section title="得点">
      <Async query={scores}>
        {(data) =>
          data.teams.length === 0 ? (
            <Text c="dimmed">チームが登録されていません</Text>
          ) : (
            <>
            <Text c="dimmed" size="sm">
              {data.rule.fixedAfterMatches}試合目までは、勝つと、記録した点数で集計します。{data.rule.fixedAfterMatches + 1}試合目からは、勝つと{data.rule.fixedPoints}pt固定です（設定で変えられます）。
            </Text>
            <Table.ScrollContainer minWidth={420}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>順位</Table.Th>
                    <Table.Th>チーム</Table.Th>
                    <Table.Th ta="right">得点</Table.Th>
                    <Table.Th ta="right">試合数</Table.Th>
                    <Table.Th ta="right">勝利数</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.teams.map((team) => {
                    const rank = data.teams.findIndex((other) => other.total === team.total) + 1;
                    // 試合数が N を超えたあとの試合は、勝っても、記録した点数に関係なく、固定点で数える
                    const exceeded = team.matches > data.rule.fixedAfterMatches;
                    return (
                      <Table.Tr key={team.teamId} {...(team.matches === 0 ? { c: "dimmed" } : {})}>
                        <Table.Td>{rank}位</Table.Td>
                        <Table.Td>{team.name}</Table.Td>
                        <Table.Td ta="right">
                          <Text span fw={700}>
                            {team.total}
                          </Text>
                          {" pt"}
                        </Table.Td>
                        <Table.Td ta="right">
                          <Group gap="xs" justify="flex-end" wrap="nowrap">
                            {exceeded && (
                              <Badge color="yellow" variant="light" tt="none">
                                {data.rule.fixedPoints}pt固定（試合数{data.rule.fixedAfterMatches}を超過）
                              </Badge>
                            )}
                            <Text span fw={700}>
                              {team.matches}
                            </Text>
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right">{team.wins.length}</Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            </>
          )
        }
      </Async>
    </Section>
  );
}

function Teams() {
  const teams = useTeams();
  const roles = useRoles();
  const [roleId, setRoleId] = useState("");
  const refresh = [["teams"], ["scores"]];
  const add = useInvalidatingMutation((input: { roleId: string }) => unwrap(api.teams.$post({ json: input })), refresh);
  const remove = useInvalidatingMutation((id: number) => unwrap(api.teams[":id"].$delete({ param: { id: String(id) } })), refresh);

  // すでにチームにしたロールは、選べない
  const registered = new Set(teams.data?.teams.map((team) => team.roleId));

  return (
    <Section title="チームの追加と削除">
      <Text c="dimmed" size="sm">
        チームは、Discord のロールです。名前もロールのものを使い、そのロールを持つ人が、メンバーです。削除しても、過去の組分け・勝利は残ります（同じロールを追加し直すと、元に戻ります）。まだ組まれていない枠の挙手は、取り消されます。
      </Text>
      <Async query={teams}>
        {(data) =>
          data.teams.length === 0 ? (
            <Text c="dimmed">チームが登録されていません</Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ロール</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.teams.map((team) => (
                  <Table.Tr key={team.id}>
                    <Table.Td>{team.name}</Table.Td>
                    <Table.Td ta="right">
                      <ConfirmButton label="削除" danger disabled={remove.isPending} onConfirm={() => remove.mutate(team.id)} />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )
        }
      </Async>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          add.mutate({ roleId }, { onSuccess: () => setRoleId("") });
        }}
      >
        <Group align="flex-end">
          {roles.data ? (
            <NativeSelect
              label="ロール"
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
              data={[{ value: "", label: "選択してください" }, ...roles.data.roles.filter((role) => !registered.has(role.id)).map((role) => ({ value: role.id, label: role.name }))]}
            />
          ) : (
            <TextInput label="ロール ID" value={roleId} onChange={(event) => setRoleId(event.target.value)} inputMode="numeric" />
          )}
          <Button type="submit" disabled={roleId === "" || add.isPending}>
            追加する
          </Button>
        </Group>
      </form>
      {roles.isError && (
        <Text c="dimmed" size="sm">
          Discord からロール一覧を取得できなかったため、ロール ID を直接入力してください。
        </Text>
      )}
      <ErrorNote error={add.error ?? remove.error} />
    </Section>
  );
}
