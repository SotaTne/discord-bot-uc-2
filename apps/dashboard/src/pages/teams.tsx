import { Badge, Button, CloseButton, Group, NativeSelect, Table, Text, TextInput, UnstyledButton } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { Async, ConfirmButton, ErrorNote, PageTitle, ScreenshotLink, Section, SortableTh, nextSort, type SortDirection } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatHour } from "../lib/format";
import { useBoard, useInvalidatingMutation, useRoles, useScores, useTeamHistory, useTeams } from "../lib/queries";

/** チームごとの得点と成績。チームの追加と削除（チームは、Discord のロール） */
export function TeamsPage() {
  // 詳細を開いているチーム。いくつでも開ける。開いている行を押すと、そのチームだけ閉じる
  const [openIds, setOpenIds] = useState<number[]>([]);
  const toggle = (teamId: number) => setOpenIds((current) => (current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]));

  return (
    <>
      <PageTitle>チーム</PageTitle>
      <Scoreboard openIds={openIds} onToggle={toggle} />
      <Teams />
    </>
  );
}

type ScoreTeam = NonNullable<ReturnType<typeof useScores>["data"]>["teams"][number];
type SortKey = "rank" | "name" | "total" | "matches" | "wins";

function Scoreboard({ openIds, onToggle }: { openIds: number[]; onToggle: (teamId: number) => void }) {
  const scores = useScores();
  // 今日の挙手（挙手できるのは、当日だけ）。マッチング済みの対戦枠の挙手は、取り消せない
  const board = useBoard(undefined);
  const withdraw = useInvalidatingMutation(
    (id: number) => unwrap(api.handups[":id"].$delete({ param: { id: String(id) } })),
    [["board"], ["scores"]],
  );
  const handupsOf = (teamId: number) =>
    (board.data?.slots ?? []).flatMap((slot) =>
      slot.handups.filter((handup) => handup.team.id === teamId).map((handup) => ({ id: handup.id, hour: slot.hour, matched: slot.matched })),
    );
  // 並び替え（見出しを押して切り替える）。何も選んでいないときは、得点の高い順（順位の順）
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const directionOf = (key: SortKey) => (sort?.key === key ? sort.direction : null);
  const header = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <SortableTh label={label} align={align} direction={directionOf(key)} onSort={() => setSort((current) => nextSort(current, key))} />
  );
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
                    {header("rank", "順位", "left")}
                    {header("name", "チーム", "left")}
                    <Table.Th>挙手中（今日）</Table.Th>
                    {header("total", "得点")}
                    {header("matches", "試合数")}
                    {header("wins", "勝利数")}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sortTeams(data.teams, sort).map((team) => {
                    const rank = data.teams.findIndex((other) => other.total === team.total) + 1;
                    // 試合数が N を超えたあとの試合は、勝っても、記録した点数に関係なく、固定点で数える
                    const exceeded = team.matches > data.rule.fixedAfterMatches;
                    const opened = openIds.includes(team.teamId);
                    return (
                      <Fragment key={team.teamId}>
                      <Table.Tr style={{ cursor: "pointer" }} onClick={() => onToggle(team.teamId)} {...(team.matches === 0 ? { c: "dimmed" } : {})}>
                        <Table.Td>{rank}位</Table.Td>
                        <Table.Td>
                          {/* 行のどこを押しても開閉するが、キーボードで開けるように、名前を、ボタンにする */}
                          <UnstyledButton
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggle(team.teamId);
                            }}
                            aria-expanded={opened}
                            aria-label={`${team.name}の詳細を${opened ? "閉じる" : "開く"}`}
                          >
                            {team.name}
                          </UnstyledButton>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            {handupsOf(team.teamId).map((handup) => (
                              <Badge
                                key={handup.id}
                                color={handup.matched ? "green" : "gray"}
                                variant="light"
                                tt="none"
                                title={handup.matched ? "マッチング済み（取り消せません）" : undefined}
                                rightSection={
                                  handup.matched ? undefined : (
                                    <CloseButton
                                      size="xs"
                                      disabled={withdraw.isPending}
                                      // 行の「詳細を開く」に、クリックを伝えない。止めるのは、このボタンだけ（周りの空白は、行のクリックとして、詳細を開く）
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        withdraw.mutate(handup.id);
                                      }}
                                      aria-label={`${team.name}の${formatHour(handup.hour)}の挙手を取り消す`}
                                    />
                                  )
                                }
                              >
                                {formatHour(handup.hour)}
                              </Badge>
                            ))}
                            {handupsOf(team.teamId).length === 0 && <Text span c="dimmed">—</Text>}
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right">{team.total}pt</Table.Td>
                        <Table.Td ta="right">
                          <Group gap="xs" justify="flex-end" wrap="nowrap">
                            {exceeded && (
                              <Badge color="yellow" variant="light" tt="none">
                                {data.rule.fixedPoints}pt固定（試合数{data.rule.fixedAfterMatches}を超過）
                              </Badge>
                            )}
                            <Text span>{team.matches}</Text>
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right">{team.wins.length}</Table.Td>
                      </Table.Tr>
                      {opened && (
                        <Table.Tr>
                          <Table.Td colSpan={6} bg="var(--mantine-color-gray-light)">
                            <TeamHistory teamId={team.teamId} name={team.name} />
                          </Table.Td>
                        </Table.Tr>
                      )}
                      </Fragment>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <ErrorNote error={withdraw.error} />
            </>
          )
        }
      </Async>
    </Section>
  );
}

/** そのチームの、全組分けと結果。チームの行の下に、開いて出す */
function TeamHistory({ teamId, name }: { teamId: number; name: string }) {
  const history = useTeamHistory(teamId);

  return (
    <section aria-label={`${name}の詳細`}>
      <Async query={history}>
        {(data) =>
          data.matches.length === 0 ? (
            <Text c="dimmed">まだ組分けがありません</Text>
          ) : (
            <Table.ScrollContainer minWidth={520}>
              <Table aria-label="対戦の記録">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>試合</Table.Th>
                    <Table.Th>日時</Table.Th>
                    <Table.Th>相手</Table.Th>
                    <Table.Th>結果</Table.Th>
                    <Table.Th>点数</Table.Th>
                    <Table.Th>画像</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.matches.map((match) => (
                    <Table.Tr key={match.matchId}>
                      <Table.Td>{match.matchNumber}試合目</Table.Td>
                      <Table.Td>
                        {/* その日の対戦枠のページを開く */}
                        <Link to="/" search={{ date: match.slotDate }} className="text-link">
                          {match.slotDate.slice(5).replace("-", "/")} {formatHour(match.slotHour)}
                        </Link>
                      </Table.Td>
                      <Table.Td>{match.opponent.name}</Table.Td>
                      <Table.Td>
                        {match.result === "win" && (
                          <Badge color="green" variant="light" tt="none">
                            勝利
                          </Badge>
                        )}
                        {match.result === "loss" && (
                          <Badge color="gray" variant="light" tt="none">
                            敗北
                          </Badge>
                        )}
                        {match.result === "none" && <Text span c="dimmed">未記録</Text>}
                        {match.deletedWins > 0 && (
                          <Text size="xs" c="dimmed">
                            削除済み {match.deletedWins}件
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {match.result === "win" && match.win
                          ? match.win.points === match.win.countedPoints
                            ? `${match.win.points}pt`
                            : `${match.win.points} → ${match.win.countedPoints}pt`
                          : "—"}
                      </Table.Td>
                      <Table.Td>{match.win?.hasScreenshot ? <ScreenshotLink winId={match.win.id} label="画像" /> : "—"}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )
        }
      </Async>
    </section>
  );
}

const compareBy: Record<SortKey, (a: ScoreTeam, b: ScoreTeam) => number> = {
  rank: (a, b) => b.total - a.total,
  name: (a, b) => a.name.localeCompare(b.name, "ja"),
  total: (a, b) => a.total - b.total,
  matches: (a, b) => a.matches - b.matches,
  wins: (a, b) => a.wins.length - b.wins.length,
};

/** 選んだ列で並べ替える（同じ値は、元の並びのまま）。順位は、並び替えても、得点から決まる */
function sortTeams(teams: ScoreTeam[], sort: { key: SortKey; direction: SortDirection } | null): ScoreTeam[] {
  if (!sort) return teams;
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...teams].sort((a, b) => sign * compareBy[sort.key](a, b));
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
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.teams.map((team) => (
                  <Table.Tr key={team.id}>
                    <Table.Td>{team.name}</Table.Td>
                    <Table.Td ta="right">
                      <ConfirmButton
                        label="削除"
                        danger
                        description="過去の組分けと勝利は残ります。まだ組まれていない対戦枠の挙手は取り消されます。同じロールを追加し直すと、元に戻ります。"
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
      <ErrorNote error={add.error ?? remove.error} />
    </Section>
  );
}
