import { Badge, Stack, Table, Text, Title } from "@mantine/core";
import { userName, type MockStateData, type Snapshot } from "../mockState";
import { hourLabel } from "../time";

const slotText = (date: string | null, hour: number | null) => (date ? `${date.slice(5).replace("-", "/")} ${hourLabel(hour ?? 0)}` : "");

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <Title order={2} className="section-title">
        {title}
      </Title>
      {children}
    </section>
  );
}

/** 状態。overview: 対戦枠（今日）・チームごとの 挙手中・対戦数 / history: マッチングログ */
export function StatePanel({ state, part }: { state: MockStateData; part: "overview" | "history" }) {
  const { snapshot, snapshotError } = state;
  if (!snapshot) {
    if (part === "history") return null;
    return (
      <Text role="alert" c="red">
        worker の状態を取得できません: {snapshotError ?? "不明なエラー"}
      </Text>
    );
  }

  return (
    <Stack gap="xl">
      {part === "overview" ? (
        <>
          <Fixtures snapshot={snapshot} />
          <Teams state={state} snapshot={snapshot} />
        </>
      ) : (
        <Rounds snapshot={snapshot} />
      )}
    </Stack>
  );
}

function Fixtures({ snapshot }: { snapshot: Snapshot }) {
  const matched = new Set(snapshot.matchSlots.filter((slot) => slot.status === "matched").map((slot) => slot.slotHour));
  return (
    <Panel title="対戦枠（今日）">
      <div className="fixtures">
        {snapshot.slotHours.map((hour) => (
          <div key={hour} className="fixture surface">
            <span className="fixture-time">{hourLabel(hour)}</span>
            <Badge color={matched.has(hour) ? "green" : "gray"} variant="light" tt="none">
              {matched.has(hour) ? "マッチング済み" : "未マッチング"}
            </Badge>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Teams({ state, snapshot }: { state: MockStateData; snapshot: Snapshot }) {
  const handupsOf = (teamId: number) => snapshot.handups.filter((handup) => handup.teamId === teamId).sort((a, b) => a.slotHour - b.slotHour);
  return (
    <Panel title="チーム">
      <Table.ScrollContainer minWidth={420} className="surface">
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>チーム</Table.Th>
              <Table.Th>挙手中</Table.Th>
              <Table.Th ta="right">対戦</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {snapshot.teamStats.map((team) => (
              <Table.Tr key={team.teamId}>
                <Table.Td>{team.name}</Table.Td>
                <Table.Td>
                  {handupsOf(team.teamId).map((handup) => (
                    <div key={handup.id}>
                      {hourLabel(handup.slotHour)} <Text span c="dimmed">{userName(state, handup.raisedBy)}</Text>
                    </div>
                  ))}
                </Table.Td>
                <Table.Td ta="right">{team.matches}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Panel>
  );
}

function Rounds({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Panel title="マッチングログ">
      {snapshot.rounds.length === 0 ? (
        <div className="empty surface">まだありません</div>
      ) : (
        <Stack gap={0} className="surface">
          {snapshot.rounds.map((round, index) => (
            <div key={index} className="row">
              <span className="log-when">{slotText(round.slotDate, round.slotHour)}</span>
              <div>
                {round.pairs.length > 0 ? (
                  round.pairs.map((pair, pairIndex) => (
                    <div key={pairIndex}>
                      <b>{pair.a}</b> vs <b>{pair.b}</b>
                    </div>
                  ))
                ) : (
                  <Text c="dimmed" span>組めず</Text>
                )}
                {round.excluded && <Text c="dimmed" size="sm">除外 {round.excluded}</Text>}
              </div>
            </div>
          ))}
        </Stack>
      )}
    </Panel>
  );
}
