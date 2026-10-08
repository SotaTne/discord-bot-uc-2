import { ActionIcon, Anchor, Badge, Button, Card, Divider, Group, NativeSelect, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { useRef, useState, type FormEvent } from "react";
import { Async, ConfirmButton, ErrorNote, ScreenshotLink, usePointsEditor } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatDateWithWeekday, formatHour, formatJstDateTime, shiftDate } from "../lib/format";
import { useBoard, useInvalidatingMutation, useTeams } from "../lib/queries";

/** 枠の画面で更新したあとに、取り直すデータ */
const REFRESH = [["board"], ["wins"], ["scores"]];

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
 * 枠の画面（入口）: 日付ごとに、枠 → 挙手・組分け・勝利を、1か所で扱う。
 * 管理者が、組分けを追加（挙手は自動で付く）して、その行から勝利を記録する。
 */
export function BoardPage() {
  // 選んだ日付（省略は、今日）。続けて押しても、1日ずつ進むように、表示中のデータではなく、これを基準にする
  const [date, setDate] = useState<string | undefined>(undefined);
  const board = useBoard(date);
  const current = date ?? board.data?.today;

  return (
    <>
      {current && (
        <Group component="header" gap="sm">
          <ActionIcon variant="default" size="lg" aria-label="前の日" onClick={() => setDate(shiftDate(current, -1))}>
            ◀
          </ActionIcon>
          <Title order={1} size="h3" ta="center" miw="7em">
            {formatDateWithWeekday(current)}
          </Title>
          <ActionIcon variant="default" size="lg" aria-label="次の日" onClick={() => setDate(shiftDate(current, 1))}>
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
        {(data) => (
          <>
            {data.slots.length === 0 && <Text c="dimmed">試合の時刻が登録されていません（設定で追加できます）</Text>}
            {data.slots.map((slot) => (
              <SlotCard key={slot.hour} date={data.date} slot={slot} />
            ))}
          </>
        )}
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

  // マッチングの確定（cron の締切と同じ処理）と、やり直し（組分けと勝利を消して、挙手を受け付ける状態に戻す）
  const confirm = useInvalidatingMutation(
    () => unwrap(api["match-slots"].confirm.$post({ json: { slotHour: slot.hour, slotDate: date } })),
    REFRESH,
  );
  const reopen = useInvalidatingMutation(
    () => unwrap(api["match-slots"].reopen.$post({ json: { slotHour: slot.hour, slotDate: date } })),
    REFRESH,
  );
  const winCount = slot.matches.filter((match) => match.win).length + slot.matches.reduce((sum, match) => sum + match.deletedWins, 0);
  const reopenLabel =
    slot.matches.length === 0
      ? "やり直しを実行する"
      : `組分け${slot.matches.length}件${winCount > 0 ? `と勝利${winCount}件` : ""}を削除して、やり直す`;

  return (
    <Card component="section" aria-label={`${formatHour(slot.hour)}の枠`}>
      <Stack gap="md">
        <Group gap="sm">
          <Title order={2} size="h3">
            {formatHour(slot.hour)}
          </Title>
          <Badge color={slot.matched ? "green" : slot.phase === "open" ? "blue" : "gray"} variant="light" tt="none">
            {slot.matched ? "マッチング済み" : (PHASE_LABEL[slot.phase] ?? slot.phase)}
          </Badge>
          <div style={{ flex: 1 }} />
          {slot.matched ? (
            <ConfirmButton
              label="やり直す"
              confirmLabel={reopenLabel}
              heavy
              description="この枠の組分けと勝利（画像も）を削除して、未マッチングに戻します。挙手は残ります。元に戻せません。"
              danger disabled={reopen.isPending} onConfirm={() => reopen.mutate()} />
          ) : (
            <ConfirmButton
              label="マッチング処理を実行する"
              confirmLabel="実行して、投稿する"
              heavy
              description="挙手を組んで、結果を Discord に投稿します（組まれたチームのロールに、通知が飛びます）。" disabled={confirm.isPending} onConfirm={() => confirm.mutate()} />
          )}
        </Group>
        <ErrorNote error={confirm.error ?? reopen.error} />

        <Stack gap="xs">
          <Text fw={600} size="sm" c="dimmed">
            挙手
          </Text>
          {slot.handups.length === 0 ? (
            <Text c="dimmed" size="sm">
              まだありません
            </Text>
          ) : (
            slot.handups.map((handup) => (
              <Group key={handup.id} gap="sm">
                <Text fw={700}>{handup.team.name}</Text>
                <Text c="dimmed" size="sm">
                  {handup.raisedByName}・{formatJstDateTime(handup.createdAt)}
                </Text>
                {!slot.matched && (
                  <Button
                    variant="default"
                    disabled={withdraw.isPending}
                    onClick={() => withdraw.mutate(handup.id)}
                    aria-label={`${handup.team.name}の${formatHour(slot.hour)}の挙手を取り消す`}
                  >
                    取り消す
                  </Button>
                )}
              </Group>
            ))
          )}
          {!slot.matched && <AddHandup date={date} hour={slot.hour} candidates={notHandedUp} />}
          <ErrorNote error={withdraw.error} />
        </Stack>

        <Divider />

        <Stack gap="xs">
          <Text fw={600} size="sm" c="dimmed">
            組分け
          </Text>
          {slot.matches.length === 0 ? (
            <Text c="dimmed" size="sm">
              まだありません
            </Text>
          ) : (
            slot.matches.map((match) => <MatchRow key={match.id} match={match} />)
          )}
          {slot.excluded && (
            <Text c="dimmed" size="sm">
              組まれなかったチーム: {slot.excluded.name}
            </Text>
          )}
          <AddMatch date={date} hour={slot.hour} candidates={free} />
        </Stack>
      </Stack>
    </Card>
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
      onSubmit={(event) => {
        event.preventDefault();
        if (teamId !== "") add.mutate(teamId, { onSuccess: () => setTeamId("") });
      }}
    >
      <Group align="flex-end" gap="sm">
        <NativeSelect label="挙手を追加" value={teamId} onChange={(event) => setTeamId(toId(event.target.value))} data={teamOptions(candidates, "チームを選択")} />
        <Button type="submit" disabled={teamId === "" || add.isPending}>
          追加
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
      <Group align="flex-end" gap="sm">
        <NativeSelect
          label={`${formatHour(hour)}の組分けを追加（1チーム目）`}
          value={teamAId}
          onChange={(event) => setTeamAId(toId(event.target.value))}
          data={teamOptions(candidates.filter((team) => team.id !== teamBId), "チームを選択")}
        />
        <NativeSelect
          label="2チーム目"
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

function MatchRow({ match }: { match: Match }) {
  const removeMatch = useInvalidatingMutation(
    (id: number) => unwrap(api.matches[":id"].$delete({ param: { id: String(id) } })),
    REFRESH,
  );
  const removeWin = useInvalidatingMutation(
    (id: number) => unwrap(api.wins[":id"].active.$put({ param: { id: String(id) }, json: { active: false } })),
    REFRESH,
  );
  // 組分けを削除すると、その勝利（削除済みのものも）と画像も消える。確認に、その件数を出す
  const winCount = (match.win ? 1 : 0) + match.deletedWins;

  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Group gap="sm">
          <Text fw={700}>
            {match.teamA.name} vs {match.teamB.name}
          </Text>
          <ConfirmButton
            label="組分けを削除"
            confirmLabel={winCount > 0 ? `勝利${winCount}件も削除して、実行する` : "削除を実行する"}
            danger
            disabled={removeMatch.isPending}
            onConfirm={() => removeMatch.mutate(match.id)}
          />
        </Group>
        {match.win ? (
          <WinLine match={match} win={match.win} onRemove={() => removeWin.mutate(match.win!.id)} pending={removeWin.isPending} />
        ) : (
          <RecordWin match={match} />
        )}
        <ErrorNote error={removeMatch.error ?? removeWin.error} />
      </Stack>
    </Paper>
  );
}

type Win = NonNullable<Match["win"]>;

/** 記録された勝利。点数を直す・削除は、同じ並びに置く */
function WinLine({ match, win, pending, onRemove }: { match: Match; win: Win; pending: boolean; onRemove: () => void }) {
  const label = `${match.teamA.name} vs ${match.teamB.name}の勝利`;
  const edit = usePointsEditor({ winId: win.id, points: win.points, label });
  return (
    <>
      <Group gap="sm">
        <Text span>
          勝ち: <strong>{win.team.name}</strong>
        </Text>
        {edit.points}
        <Text c="dimmed" size="sm">
          {win.recordedByName}・{formatJstDateTime(win.createdAt)}
        </Text>
        {win.hasScreenshot && (
          <ScreenshotLink winId={win.id} label="画像" />
        )}
        <Group gap="xs" wrap="nowrap">
          {edit.buttons}
          <Button variant="default" disabled={pending} onClick={onRemove} aria-label={`${label}を削除`}>
            勝利を削除
          </Button>
        </Group>
      </Group>
      <ErrorNote error={edit.error} />
    </>
  );
}

function RecordWin({ match }: { match: Match }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [teamId, setTeamId] = useState<number | "">("");
  const [points, setPoints] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const record = useInvalidatingMutation(
    (form: FormData) => unwrap(api.matches[":id"].wins.$post({ param: { id: String(match.id) } }, { init: { body: form } })),
    REFRESH,
  );
  const ready = teamId !== "" && points !== "" && image !== null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const form = new FormData();
    form.set("teamId", String(teamId));
    form.set("points", points);
    form.set("image", image);
    record.mutate(form, {
      onSuccess: () => {
        formRef.current?.reset();
        setTeamId("");
        setPoints("");
        setImage(null);
      },
    });
  }

  const label = `${match.teamA.name} vs ${match.teamB.name}`;
  return (
    <form ref={formRef} onSubmit={submit} aria-label={`${label}の勝利を記録`}>
      <Group align="flex-end" gap="sm">
        <NativeSelect label="勝ったチーム" value={teamId} onChange={(event) => setTeamId(toId(event.target.value))} data={teamOptions([match.teamA, match.teamB], "選択")} />
        <TextInput label="点数" type="number" min={0} step={1} w={110} value={points} onChange={(event) => setPoints(event.target.value)} />
        <TextInput label="スクリーンショット" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => setImage(event.target.files?.[0] ?? null)} />
        <Button type="submit" disabled={!ready || record.isPending}>
          勝利を記録
        </Button>
      </Group>
      <ErrorNote error={record.error} />
    </form>
  );
}
