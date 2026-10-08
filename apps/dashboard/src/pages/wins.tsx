import { Button, Checkbox, Group, NativeSelect, Table, Text } from "@mantine/core";
import { useState } from "react";
import { Async, ConfirmButton, ErrorNote, PageTitle, RowMenu, ScreenshotLink, Section, SortableTh, nextSort, usePointsEditor, type SortDirection } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatHour, formatJstDateTime } from "../lib/format";
import { useInvalidatingMutation, useWins } from "../lib/queries";

const REFRESH = [["scores"], ["wins"], ["board"]];

/** 勝利の記録の履歴（削除した記録も含む）と、得点のクリア（すべての履歴の削除） */
export function WinsPage() {
  return (
    <>
      <PageTitle>勝利ログ</PageTitle>
      <History />
      <ClearScores />
    </>
  );
}

type WinRecord = NonNullable<ReturnType<typeof useWins>["data"]>["wins"][number];

type SortKey = "id" | "slot" | "team" | "points" | "recorder" | "createdAt";

const compareBy: Record<SortKey, (a: WinRecord, b: WinRecord) => number> = {
  id: (a, b) => a.id - b.id,
  slot: (a, b) => a.slotDate.localeCompare(b.slotDate) || a.slotHour - b.slotHour,
  team: (a, b) => a.teamName.localeCompare(b.teamName, "ja"),
  points: (a, b) => a.points - b.points,
  recorder: (a, b) => a.recordedByName.localeCompare(b.recordedByName, "ja"),
  createdAt: (a, b) => a.createdAt - b.createdAt,
};

const ALL = "";
const unique = (values: string[]) => [...new Set(values)];

function History() {
  const wins = useWins();
  const setActive = useInvalidatingMutation(
    (input: { id: number; active: boolean }) =>
      unwrap(api.wins[":id"].active.$put({ param: { id: String(input.id) }, json: { active: input.active } })),
    REFRESH,
  );
  // 絞り込み（画面の中で行う。データは、すべて取ってある）と、並び替え（見出しを押して切り替える）
  const [team, setTeam] = useState(ALL);
  const [date, setDate] = useState(ALL);
  const [recorder, setRecorder] = useState(ALL);
  const [showDeleted, setShowDeleted] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const directionOf = (key: SortKey) => (sort?.key === key ? sort.direction : null);
  const header = (key: SortKey, label: string) => <SortableTh label={label} direction={directionOf(key)} onSort={() => setSort((current) => nextSort(current, key))} />;

  return (
    <Section title="履歴">
      <Text c="dimmed" size="sm">
        削除した記録も、ここに残ります（得点には数えません）。「元に戻す」で、数え直されます。同じ組分けに、ほかの勝利があるときは、戻せません。
      </Text>
      <Async query={wins}>
        {(data) => {
          if (data.wins.length === 0) return <Text c="dimmed">まだ記録がありません</Text>;

          const options = (label: string, values: string[]) => [{ value: ALL, label }, ...values.map((value) => ({ value, label: value }))];
          const teams = unique(data.wins.flatMap((win) => [win.match.teamA, win.match.teamB])).sort((a, b) => a.localeCompare(b, "ja"));
          const dates = unique(data.wins.map((win) => win.slotDate)).sort().reverse();
          const recorders = unique(data.wins.map((win) => win.recordedByName)).sort((a, b) => a.localeCompare(b, "ja"));

          const filtered = data.wins.filter(
            (win) =>
              (team === ALL || win.match.teamA === team || win.match.teamB === team) &&
              (date === ALL || win.slotDate === date) &&
              (recorder === ALL || win.recordedByName === recorder) &&
              (showDeleted || win.active),
          );
          const sign = sort?.direction === "desc" ? -1 : 1;
          const rows = sort ? [...filtered].sort((a, b) => sign * compareBy[sort.key](a, b)) : filtered;

          return (
            <>
              <Group gap="sm">
                <NativeSelect aria-label="チームで絞り込み" w={160} value={team} onChange={(event) => setTeam(event.target.value)} data={options("すべてのチーム", teams)} />
                <NativeSelect aria-label="日付で絞り込み" w={160} value={date} onChange={(event) => setDate(event.target.value)} data={options("すべての日付", dates)} />
                <NativeSelect aria-label="記録者で絞り込み" w={160} value={recorder} onChange={(event) => setRecorder(event.target.value)} data={options("すべての記録者", recorders)} />
                <Checkbox label="削除済みも表示" checked={showDeleted} onChange={(event) => setShowDeleted(event.currentTarget.checked)} />
                <Text c="dimmed" size="sm" role="status">
                  {rows.length}件
                </Text>
              </Group>
              {rows.length === 0 ? (
                <Text c="dimmed">条件に合う記録がありません</Text>
              ) : (
                <Table.ScrollContainer minWidth={760}>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        {header("id", "#")}
                        {header("slot", "対戦枠")}
                        <Table.Th>組分け</Table.Th>
                        {header("team", "勝利チーム")}
                        {header("points", "点数")}
                        {header("recorder", "記録者")}
                        {header("createdAt", "記録日時")}
                        <Table.Th>画像</Table.Th>
                        <Table.Th />
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {rows.map((win) => (
                        <WinRow key={win.id} win={win} pending={setActive.isPending} onToggle={() => setActive.mutate({ id: win.id, active: !win.active })} />
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </>
          );
        }}
      </Async>
      <ErrorNote error={setActive.error} />
    </Section>
  );
}

/** 1件の記録。操作（点数の編集・削除・元に戻す）は、右端の「操作 ▾」メニューに入れる */
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
          <ScreenshotLink winId={win.id} label="画像" />
        ) : (
          "—"
        )}
      </Table.Td>
      <Table.Td>
        <Group justify="flex-end" wrap="nowrap">
          {edit.controls ?? (
            <RowMenu
              label={`勝利#${win.id}の操作`}
              items={[
                { label: "点数を編集", onClick: edit.start },
                { label: win.active ? "勝利を削除" : "勝利を元に戻す", onClick: onToggle, disabled: pending },
              ]}
            />
          )}
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
          label="全てクリア"
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
