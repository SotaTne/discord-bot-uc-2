import { ActionIcon, Badge, Button, Checkbox, CloseButton, Group, NativeSelect, Paper, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Async, ConfirmButton, ConfirmDialog, ErrorNote } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatDateWithWeekday, formatHour, formatJstDateTime, shiftDate } from "../lib/format";
import { useBoard, useInvalidatingMutation, useTeams } from "../lib/queries";

/** 対戦枠の画面で更新したあとに、取り直すデータ */
const REFRESH = [["board"], ["teams"]];

type Board = Awaited<ReturnType<typeof useBoard>["data"]> & object;
type Slot = Board["slots"][number];
type Match = Slot["matches"][number];
type Team = { id: number; name: string };

const PHASE_LABEL: Record<string, string> = {
  "before-open": "募集開始前",
  open: "受付中",
  closed: "締切",
};

/**
 * 対戦枠の画面（入口）: 日付ごとに、対戦枠 → 挙手・組分けを、1か所で扱う。
 * 管理者が、組分けを追加（挙手は自動で付く）したり、削除したりする。
 */
export function BoardPage() {
  // 見ている日付は、URL に持つ（省略は、今日）。続けて押しても、1日ずつ進むように、表示中のデータではなく、URL の日付を基準にする
  const { date } = useSearch({ strict: false }) as { date?: string };
  const navigate = useNavigate();
  const board = useBoard(date);
  const current = date ?? board.data?.today;
  // 続けて押したとき、URL が変わる前に、次の押下が来る。向かっている日付を覚えておいて、それを基準に 1 日ずつ進める
  const heading = useRef<string | undefined>(date);
  useEffect(() => {
    heading.current = date;
  }, [date]);
  const setDate = (next: string | undefined) => {
    heading.current = next;
    void navigate({ to: "/", search: next === undefined ? {} : { date: next } });
  };
  const shift = (days: number) => {
    const base = heading.current ?? board.data?.today;
    if (base) setDate(shiftDate(base, days));
  };

  return (
    <>
      {current && (
        <Group component="header" gap="xs">
          <ActionIcon variant="default" size="lg" aria-label="前の日" onClick={() => shift(-1)}>
            ◀
          </ActionIcon>
          <Title order={1} ta="center" miw="7.5em">
            {formatDateWithWeekday(current)}
          </Title>
          <ActionIcon variant="default" size="lg" aria-label="次の日" onClick={() => shift(1)}>
            ▶
          </ActionIcon>
          {date !== undefined && date !== board.data?.today && (
            <Button variant="default" onClick={() => setDate(undefined)}>
              今日
            </Button>
          )}
        </Group>
      )}
      <Async query={board}>
        {(data) =>
          data.slots.length === 0 ? (
            <Text c="dimmed">試合時刻が登録されていません。設定で追加してください。</Text>
          ) : (
            // 進行表: 対戦枠を、時刻の順に、1 つの面に並べる（細い線で区切る）
            <div className="surface">
              {data.slots.map((slot) => (
                <SlotCard key={slot.hour} date={data.date} slot={slot} />
              ))}
            </div>
          )
        }
      </Async>
    </>
  );
}

function SlotCard({ date, slot }: { date: string; slot: Slot }) {
  const teams = useTeams();
  const handedUp = new Set(slot.handups.map((handup) => handup.team.id));
  const matched = new Set(slot.matches.flatMap((match) => [match.teamA.id, match.teamB.id]));
  const notHandedUp = teams.data?.teams.filter((team) => !handedUp.has(team.id)) ?? [];
  const free = teams.data?.teams.filter((team) => !matched.has(team.id)) ?? [];

  const withdraw = useInvalidatingMutation(
    (id: number) => unwrap(api.handups[":id"].$delete({ param: { id: String(id) } })),
    REFRESH,
  );

  // マッチングの確定（cron の締切と同じ処理）と、やり直し（組分けを消して、挙手を受け付ける状態に戻す）
  const confirm = useInvalidatingMutation(
    () => unwrap(api["match-slots"].confirm.$post({ json: { slotHour: slot.hour, slotDate: date } })),
    REFRESH,
  );
  // やり直すとき、Discord に、マッチングのキャンセルを投稿するか（初期は、投稿する）
  const [notifyCancel, setNotifyCancel] = useState(true);
  const reopen = useInvalidatingMutation(
    () => unwrap(api["match-slots"].reopen.$post({ json: { slotHour: slot.hour, slotDate: date, notify: notifyCancel } })),
    REFRESH,
  );
  // 待機の解除（継続募集中のとき）。待機しているチームの代わりに、「待機をキャンセル」を押すのと同じ。待機する（開始）は、チームの選択なので、ここには、ない
  const cancelWaiting = useInvalidatingMutation(
    () => unwrap(api["match-slots"]["cancel-waiting"].$post({ json: { slotHour: slot.hour, slotDate: date } })),
    REFRESH,
  );
  const reopenLabel = slot.matches.length === 0 ? "やり直しを実行する" : `組分け${slot.matches.length}件を削除して、やり直す`;

  // この対戦枠への操作（待機の解除 / マッチング処理の実行 / やり直し）。右の欄の上に置く
  const slotAction = (
    <>
      {slot.waiting && (
        <ConfirmButton
          label="待機を解除する"
          description={`${slot.waiting.name} の待機を解除します。募集のメッセージは削除されます。案内の「待機する」は残るので、チームは、待機し直せます。`}
          disabled={cancelWaiting.isPending}
          onConfirm={() => cancelWaiting.mutate()}
        />
      )}
      {slot.matched ? (
        <ConfirmButton
          label="やり直す"
          confirmLabel={reopenLabel}
          heavy
          description="この対戦枠の組分けを削除して、未マッチングに戻します。挙手は残ります。元に戻せません。"
          danger
          extra={
            (slot.matches.length > 0 || slot.excluded !== null) && (
              <Checkbox
                label="Discord に、マッチングのキャンセルを投稿する（組まれていたチームに通知します）"
                checked={notifyCancel}
                onChange={(event) => setNotifyCancel(event.currentTarget.checked)}
              />
            )
          }
          disabled={reopen.isPending}
          onConfirm={() => reopen.mutate()}
        />
      ) : (
        <ConfirmButton
          label="マッチング処理を実行する"
          confirmLabel="実行して、投稿する"
          heavy
          primary
          description="挙手を組んで、結果を Discord に投稿します（組まれたチームのロールに、通知が飛びます）。"
          disabled={confirm.isPending}
          onConfirm={() => confirm.mutate()}
        />
      )}
    </>
  );

  return (
    <section className={slot.deleted ? "slot slot-deleted" : "slot"} aria-label={`${formatHour(slot.hour)}の対戦枠`}>
      {/* 左: 時刻（目印）・状態・この対戦枠への操作 */}
      <Stack gap="sm" align="flex-start">
        <h2 className="slot-time">{formatHour(slot.hour)}</h2>
        {/* 状態: 未マッチング（受付の段階つき）/ マッチング済み / 継続募集中（組まれなかったチームが待機して、00 分まで、別のチームを募集している）/ 削除済み（設定で試合時刻を削除した。削除した日までの対戦枠が残る） */}
        {slot.deleted ? (
          <Badge color="gray" variant="filled" tt="none" title="設定で削除した試合時刻です。削除した日までの対戦枠が、残っています">
            削除済み
          </Badge>
        ) : slot.waiting ? (
          <Badge color="orange" variant="light" tt="none" title={`${slot.waiting.name} が待機中。試合開始まで、先着 1 チームが対戦できます`}>
            継続募集中
          </Badge>
        ) : (
          <Badge color={slot.matched ? "green" : slot.phase === "open" ? "cobalt" : "gray"} variant="light" tt="none">
            {slot.matched ? "マッチング済み" : (PHASE_LABEL[slot.phase] ?? slot.phase)}
          </Badge>
        )}
        {slot.waiting && (
          <Text size="xs" c="dimmed">
            {slot.waiting.name} が待機中
          </Text>
        )}
      </Stack>

      {/* 右: 挙手と組分け */}
      <Stack gap="lg" style={{ minWidth: 0 }}>
        <Stack gap="xs">
          <Group justify="space-between" align="center" wrap="nowrap">
            <Title order={3} c="dimmed">
              挙手 {slot.handups.length > 0 && `（${slot.handups.length}）`}
            </Title>
            {/* 削除済みの試合時刻は、マッチング処理も、やり直しも、しない（組分けだけを、扱う） */}
            {!slot.deleted && slotAction}
          </Group>
          <ErrorNote error={confirm.error ?? reopen.error ?? cancelWaiting.error} />
          {reopen.data?.notifyFailed && (
            <Text size="sm" c="red" role="alert">
              やり直しはできましたが、Discord への投稿に失敗しました。必要なら、チームに、直接お知らせください。
            </Text>
          )}
          {slot.handups.length === 0 && (slot.matched || slot.deleted) && (
            <Text c="dimmed" size="sm">
              まだありません
            </Text>
          )}
          {slot.handups.length > 0 && (
            // 挙手は、カードを格子状に並べる（チームが増えても、縦に長くならない）。チーム名の下に、誰がいつ挙手したかを小さく出す
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
              {slot.handups.map((handup) => (
                <Paper key={handup.id} withBorder px="sm" py={6}>
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text size="sm" fw={500} truncate>
                        {handup.team.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {handup.raisedByName}・{formatJstDateTime(handup.createdAt)}
                      </Text>
                    </Stack>
                    {!slot.matched && (
                      <CloseButton
                        size="sm"
                        disabled={withdraw.isPending}
                        onClick={() => withdraw.mutate(handup.id)}
                        aria-label={`${handup.team.name}の${formatHour(slot.hour)}の挙手を取り消す`}
                      />
                    )}
                  </Group>
                </Paper>
              ))}
            </SimpleGrid>
          )}
          {/* 挙手の追加は、カードの下に、間をあけて置く。幅は、カード 1 枚分にそろえる（カードの格子と同じ列の幅） */}
          {!slot.matched && !slot.deleted && (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs" mt="sm">
              <AddHandup date={date} hour={slot.hour} candidates={notHandedUp} />
            </SimpleGrid>
          )}
          <ErrorNote error={withdraw.error} />
        </Stack>

        <Stack gap="xs">
          <Title order={3} c="dimmed">
            組分け {slot.matches.length > 0 && `（${slot.matches.length}）`}
          </Title>
          {slot.matches.length === 0 ? (
            <Text c="dimmed" size="sm">
              まだありません
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={420}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>組分け</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {slot.matches.map((match) => (
                    <MatchRow key={match.id} match={match} />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          {slot.excluded && (
            <Text c="dimmed" size="sm">
              組まれなかったチーム: {slot.excluded.name}
            </Text>
          )}
          <AddMatch date={date} hour={slot.hour} candidates={free} />
        </Stack>
      </Stack>
    </section>
  );
}

/** チームを選ぶ（先頭は「チームを選択」） */
const teamOptions = (teams: Team[], placeholder: string) => [{ value: "", label: placeholder }, ...teams.map((team) => ({ value: String(team.id), label: team.name }))];
const toId = (value: string): number | "" => (value === "" ? "" : Number(value));

function AddHandup({ date, hour, candidates }: { date: string; hour: number; candidates: Team[] }) {
  const [teamId, setTeamId] = useState<number | "">("");
  const add = useInvalidatingMutation(
    (id: number) => unwrap(api.handups.$post({ json: { teamId: id, slotHour: hour, slotDate: date } })),
    REFRESH,
  );
  if (candidates.length === 0) return null;

  return (
    <form
      style={{ minWidth: 0 }}
      onSubmit={(event) => {
        event.preventDefault();
        if (teamId !== "") add.mutate(teamId, { onSuccess: () => setTeamId("") });
      }}
    >
      <Group gap="xs" wrap="nowrap">
        <NativeSelect aria-label="挙手するチーム" style={{ flex: 1, minWidth: 0 }} value={teamId} onChange={(event) => setTeamId(toId(event.target.value))} data={teamOptions(candidates, "チームを選択")} />
        <Button type="submit" variant="light" disabled={teamId === "" || add.isPending}>
          挙手を追加
        </Button>
      </Group>
      <ErrorNote error={add.error} />
    </form>
  );
}

function AddMatch({ date, hour, candidates }: { date: string; hour: number; candidates: Team[] }) {
  const [teamAId, setTeamAId] = useState<number | "">("");
  const [teamBId, setTeamBId] = useState<number | "">("");
  const add = useInvalidatingMutation(
    (input: { teamAId: number; teamBId: number }) => unwrap(api.matches.$post({ json: { ...input, slotHour: hour, slotDate: date } })),
    REFRESH,
  );
  if (candidates.length < 2) return null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (teamAId === "" || teamBId === "") return;
        add.mutate({ teamAId, teamBId }, { onSuccess: () => { setTeamAId(""); setTeamBId(""); } });
      }}
    >
      <Group gap="xs">
        <NativeSelect
          aria-label="1チーム目"
          w={180}
          value={teamAId}
          onChange={(event) => setTeamAId(toId(event.target.value))}
          data={teamOptions(candidates.filter((team) => team.id !== teamBId), "チームを選択")}
        />
        <Text c="dimmed" size="sm">
          vs
        </Text>
        <NativeSelect
          aria-label="2チーム目"
          w={180}
          value={teamBId}
          onChange={(event) => setTeamBId(toId(event.target.value))}
          data={teamOptions(candidates.filter((team) => team.id !== teamAId), "チームを選択")}
        />
        <Button type="submit" disabled={teamAId === "" || teamBId === "" || add.isPending}>
          組分けを追加
        </Button>
      </Group>
      <ErrorNote error={add.error} />
    </form>
  );
}

/** 組分けの 1 行（表の行）。右端に「削除」のボタンを置く */
function MatchRow({ match }: { match: Match }) {
  const label = `${match.teamA.name} vs ${match.teamB.name}`;
  // 表示は、各チームが何試合目かを添える（そのチームが入った組分けの数。サーバーが、組分けから数える）
  const shown = `${match.teamA.name}（${match.matchNumberA}試合目） vs ${match.teamB.name}（${match.matchNumberB}試合目）`;
  const [removing, setRemoving] = useState(false);
  const removeMatch = useInvalidatingMutation(
    (id: number) => unwrap(api.matches[":id"].$delete({ param: { id: String(id) } })),
    REFRESH,
  );

  return (
    <>
      <Table.Tr>
        <Table.Td>
          {shown}
          {/* 主催（部屋を立てる側）。組分けを作るときに、無作為に決めて保存した値 */}
          <Text span c="dimmed" size="sm" ml="xs">
            主催: {match.host.name}
          </Text>
        </Table.Td>
        <Table.Td>
          <Group justify="flex-end" wrap="nowrap">
            <Button variant="default" color="red" size="xs" onClick={() => setRemoving(true)} aria-label={`${label}を削除`}>
              削除
            </Button>
          </Group>
        </Table.Td>
      </Table.Tr>
      {removeMatch.error && (
        <Table.Tr>
          <Table.Td colSpan={2}>
            <ErrorNote error={removeMatch.error} />
          </Table.Td>
        </Table.Tr>
      )}
      <ConfirmDialog
        opened={removing}
        onClose={() => setRemoving(false)}
        title={`${label}の組分けを削除`}
        description="この組分けを削除します。"
        confirmLabel="削除を実行する"
        disabled={removeMatch.isPending}
        onConfirm={() => removeMatch.mutate(match.id)}
      />
    </>
  );
}
