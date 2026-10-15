import { Badge, Button, CloseButton, Group, NativeSelect, Table, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import { Async, ConfirmButton, ErrorNote, PageTitle, Section } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatHour } from "../lib/format";
import { useBoard, useInvalidatingMutation, useRoles, useTeams } from "../lib/queries";

/** チームの追加と削除（チームは、Discord のロール）。今日の挙手も、ここで見て、取り消せる */
export function TeamsPage() {
  return (
    <>
      <PageTitle>チーム</PageTitle>
      <Teams />
    </>
  );
}

/** 挙手のタグの色と説明。マッチング済みの対戦枠の挙手は、取り消せない */
type HandupStatus = "pending" | "paired" | "excluded";
const handupColor: Record<HandupStatus, string> = { pending: "gray", paired: "green", excluded: "orange" };
const handupTitle: Record<HandupStatus, string | undefined> = {
  pending: undefined,
  paired: "マッチング済み（取り消せません）",
  excluded: "組まれませんでした（マッチング済み。取り消せません）",
};

function Teams() {
  const teams = useTeams();
  const roles = useRoles();
  const [roleId, setRoleId] = useState("");
  const refresh = [["teams"], ["board"]];
  const add = useInvalidatingMutation((input: { roleId: string }) => unwrap(api.teams.$post({ json: input })), refresh);
  const remove = useInvalidatingMutation((id: number) => unwrap(api.teams[":id"].$delete({ param: { id: String(id) } })), refresh);

  // 今日の挙手（挙手できるのは、当日だけ）。マッチング済みの対戦枠の挙手は、取り消せない
  const board = useBoard(undefined);
  const withdraw = useInvalidatingMutation(
    (id: number) => unwrap(api.handups[":id"].$delete({ param: { id: String(id) } })),
    [["board"]],
  );
  const handupsOf = (teamId: number) =>
    (board.data?.slots ?? []).flatMap((slot) =>
      slot.handups
        .filter((handup) => handup.team.id === teamId)
        // 状態: まだ（未マッチング）/ 組まれた / 組まれなかった（マッチング済みで、奇数のため、外れた）
        .map((handup) => ({ id: handup.id, hour: slot.hour, matched: slot.matched, status: (!slot.matched ? "pending" : slot.excluded?.id === teamId ? "excluded" : "paired") as HandupStatus })),
    );

  // すでにチームにしたロールは、選べない
  const registered = new Set(teams.data?.teams.map((team) => team.roleId));

  return (
    <Section title="チームの管理">
      <Text c="dimmed" size="sm">
        チームは Discord のロールです。名前はロールの名前を使い、そのロールを持つ人がメンバーです。
      </Text>
      <Async query={teams}>
        {(data) =>
          data.teams.length === 0 ? (
            <Text c="dimmed">チームが登録されていません</Text>
          ) : (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>チーム</Table.Th>
                  <Table.Th>挙手中（今日）</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.teams.map((team) => (
                  <Table.Tr key={team.id}>
                    <Table.Td>{team.name}</Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        {handupsOf(team.id).map((handup) => (
                          <Badge
                            key={handup.id}
                            color={handupColor[handup.status]}
                            variant="light"
                            tt="none"
                            title={handupTitle[handup.status]}
                            rightSection={
                              handup.matched ? undefined : (
                                <CloseButton
                                  size="xs"
                                  disabled={withdraw.isPending}
                                  onClick={() => withdraw.mutate(handup.id)}
                                  aria-label={`${team.name}の${formatHour(handup.hour)}の挙手を取り消す`}
                                />
                              )
                            }
                          >
                            {formatHour(handup.hour)}
                          </Badge>
                        ))}
                        {handupsOf(team.id).length === 0 && <Text span c="dimmed">—</Text>}
                      </Group>
                    </Table.Td>
                    <Table.Td ta="right">
                      <ConfirmButton
                        label="削除"
                        danger
                        description="過去の組分けは残ります。まだ組まれていない対戦枠の挙手は取り消されます。同じロールを追加し直すと、元に戻ります。"
                        disabled={remove.isPending}
                        onConfirm={() => remove.mutate(team.id)}
                      />
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
        <Group gap="xs">
          {roles.data ? (
            <NativeSelect
              aria-label="追加するロール"
              w={240}
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
              data={[{ value: "", label: "ロールを選択" }, ...roles.data.roles.filter((role) => !registered.has(role.id)).map((role) => ({ value: role.id, label: role.name }))]}
            />
          ) : (
            <TextInput aria-label="ロール ID" name="roleId" placeholder="ロール ID" spellCheck={false} w={240} value={roleId} onChange={(event) => setRoleId(event.target.value)} inputMode="numeric" />
          )}
          <Button type="submit" disabled={roleId === "" || add.isPending}>
            チームを追加
          </Button>
        </Group>
      </form>
      {roles.isError && (
        <Text c="dimmed" size="sm">
          Discord からロール一覧を取得できなかったため、ロール ID を直接入力してください。
        </Text>
      )}
      <ErrorNote error={add.error ?? remove.error ?? withdraw.error} />
    </Section>
  );
}
