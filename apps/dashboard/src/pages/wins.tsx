import { Button, Group, Table, Text } from "@mantine/core";
import { Async, ConfirmButton, ErrorNote, ScreenshotLink, Section, usePointsEditor } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatHour, formatJstDateTime } from "../lib/format";
import { useInvalidatingMutation, useWins } from "../lib/queries";

const REFRESH = [["scores"], ["wins"], ["board"]];

/** 勝利の記録の履歴（削除した記録も含む）と、得点のクリア（すべての履歴の削除） */
export function WinsPage() {
  return (
    <>
      <History />
      <ClearScores />
    </>
  );
}

function History() {
  const wins = useWins();
  const setActive = useInvalidatingMutation(
    (input: { id: number; active: boolean }) =>
      unwrap(api.wins[":id"].active.$put({ param: { id: String(input.id) }, json: { active: input.active } })),
    REFRESH,
  );

  return (
    <Section title="履歴">
      <Text c="dimmed" size="sm">
        削除した記録も、ここに残ります（得点には数えません）。「元に戻す」で、数え直されます。同じ組分けに、ほかの勝利があるときは、戻せません。
      </Text>
      <Async query={wins}>
        {(data) =>
          data.wins.length === 0 ? (
            <Text c="dimmed">まだ記録がありません</Text>
          ) : (
            <Table.ScrollContainer minWidth={760}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>#</Table.Th>
                    <Table.Th>枠</Table.Th>
                    <Table.Th>組分け</Table.Th>
                    <Table.Th>勝ったチーム</Table.Th>
                    <Table.Th>点数</Table.Th>
                    <Table.Th>記録した人</Table.Th>
                    <Table.Th>記録した時刻</Table.Th>
                    <Table.Th>画像</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.wins.map((win) => (
                    <WinRow key={win.id} win={win} pending={setActive.isPending} onToggle={() => setActive.mutate({ id: win.id, active: !win.active })} />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )
        }
      </Async>
      <ErrorNote error={setActive.error} />
    </Section>
  );
}

type WinRecord = NonNullable<ReturnType<typeof useWins>["data"]>["wins"][number];

/** 1件の記録。点数を直す・削除（元に戻す）は、同じ列に、並べる */
function WinRow({ win, pending, onToggle }: { win: WinRecord; pending: boolean; onToggle: () => void }) {
  const edit = usePointsEditor({ winId: win.id, points: win.points, label: `勝利#${win.id}` });
  return (
    <Table.Tr className={win.active ? "" : "struck"}>
      <Table.Td>{win.id}</Table.Td>
      <Table.Td>
        {win.slotDate} {formatHour(win.slotHour)}
      </Table.Td>
      <Table.Td>
        {win.match.teamA} vs {win.match.teamB}
      </Table.Td>
      <Table.Td>
        {win.teamName}
        {!win.active && "（削除済み）"}
      </Table.Td>
      <Table.Td>{edit.points}</Table.Td>
      <Table.Td>{win.recordedByName}</Table.Td>
      <Table.Td>{formatJstDateTime(win.createdAt)}</Table.Td>
      <Table.Td>
        {win.hasScreenshot ? (
          <ScreenshotLink winId={win.id} label="見る" />
        ) : (
          "—"
        )}
      </Table.Td>
      <Table.Td>
        <Group gap="xs" wrap="nowrap">
          {edit.buttons}
          <Button variant="default" disabled={pending} onClick={onToggle}>
            {win.active ? "削除" : "元に戻す"}
          </Button>
        </Group>
        <ErrorNote error={edit.error} />
      </Table.Td>
    </Table.Tr>
  );
}

function ClearScores() {
  const clear = useInvalidatingMutation(() => unwrap(api.wins.$delete()), REFRESH);

  return (
    <Section title="得点をクリアする">
      <Text c="dimmed" size="sm">
        すべてのチームの得点と、勝利の履歴（画像を含む）、組分け（試合数）を削除します。1試合目からやり直しになり、元に戻せません。
      </Text>
      <Group>
        <ConfirmButton
          label="クリアする"
          confirmLabel="削除を実行する"
          heavy
          description="すべてのチームの得点と、勝利の履歴（画像を含む）、組分け（試合数）を削除します。1試合目からやり直しになり、元に戻せません。"
          danger disabled={clear.isPending} onConfirm={() => clear.mutate()} />
      </Group>
      <ErrorNote error={clear.error} />
      {clear.isSuccess && (
        <Text role="status" c="green">
          得点と履歴を削除しました
        </Text>
      )}
    </Section>
  );
}
