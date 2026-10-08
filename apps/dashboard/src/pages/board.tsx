import { ActionIcon, Anchor, Badge, Button, CloseButton, FileButton, Group, NativeSelect, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ACTION_BUTTON_WIDTH, Async, ConfirmButton, ErrorNote, ScreenshotLink, usePointsEditor } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatDateWithWeekday, formatHour, formatJstDateTime, shiftDate } from "../lib/format";
import { useBoard, useInvalidatingMutation, useTeams } from "../lib/queries";

/** 対戦枠の画面で更新したあとに、取り直すデータ */
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
 * 対戦枠の画面（入口）: 日付ごとに、対戦枠 → 挙手・組分け・勝利を、1か所で扱う。
 * 管理者が、組分けを追加（挙手は自動で付く）して、その行から勝利を追加する。
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

  // この対戦枠への操作（マッチング処理の実行 / やり直し）。右の欄の上に置く
  const slotAction = (
    <>
      {slot.matched ? (
        <ConfirmButton
          label="やり直す"
          confirmLabel={reopenLabel}
          heavy
          description="この対戦枠の組分けと勝利（画像も）を削除して、未マッチングに戻します。挙手は残ります。元に戻せません。"
          danger
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
    <section className="slot" aria-label={`${formatHour(slot.hour)}の対戦枠`}>
      {/* 左: 時刻（目印）・状態・この対戦枠への操作 */}
      <Stack gap="sm" align="flex-start">
        <h2 className="slot-time">{formatHour(slot.hour)}</h2>
        <Badge color={slot.matched ? "green" : slot.phase === "open" ? "cobalt" : "gray"} variant="light" tt="none">
          {slot.matched ? "マッチング済み" : (PHASE_LABEL[slot.phase] ?? slot.phase)}
        </Badge>
      </Stack>

      {/* 右: 挙手と組分け */}
      <Stack gap="lg" style={{ minWidth: 0 }}>
        <Stack gap="xs">
          <Group justify="space-between" align="center" wrap="nowrap">
            <Title order={3} c="dimmed">
              挙手 {slot.handups.length > 0 && `（${slot.handups.length}）`}
            </Title>
            {slotAction}
          </Group>
          <ErrorNote error={confirm.error ?? reopen.error} />
          {slot.handups.length === 0 ? (
            <Text c="dimmed" size="sm">
              まだありません
            </Text>
          ) : (
            // 挙手は、カードを格子状に並べる（チームが増えても、縦に長くならない）。チーム名の下に、誰がいつ挙手したかを小さく出す
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
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
          {!slot.matched && <AddHandup date={date} hour={slot.hour} candidates={notHandedUp} />}
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
            <Table.ScrollContainer minWidth={820}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>組分け</Table.Th>
                    <Table.Th w={110}>勝利チーム</Table.Th>
                    <Table.Th w={90}>点数</Table.Th>
                    <Table.Th w={190}>記録</Table.Th>
                    <Table.Th w={60}>画像</Table.Th>
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
      onSubmit={(event) => {
        event.preventDefault();
        if (teamId !== "") add.mutate(teamId, { onSuccess: () => setTeamId("") });
      }}
    >
      <Group gap="xs">
        <NativeSelect aria-label="挙手するチーム" w={180} value={teamId} onChange={(event) => setTeamId(toId(event.target.value))} data={teamOptions(candidates, "チームを選択")} />
        <Button type="submit" disabled={teamId === "" || add.isPending}>
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

/** 組分けの 1 行（表の行）。勝利があれば、その内容を。なければ、その場で記録するための入力欄を、出す */
function MatchRow({ match }: { match: Match }) {
  const removeMatch = useInvalidatingMutation(
    (id: number) => unwrap(api.matches[":id"].$delete({ param: { id: String(id) } })),
    REFRESH,
  );
  // 組分けを削除すると、その勝利（削除済みのものも）と画像も消える。確認に、その件数を出す
  const winCount = (match.win ? 1 : 0) + match.deletedWins;
  const removeMatchButton = (
    <ConfirmButton
      label="組分けを削除"
      icon
      confirmLabel={winCount > 0 ? `勝利${winCount}件も削除して、実行する` : "削除を実行する"}
      danger
      disabled={removeMatch.isPending}
      onConfirm={() => removeMatch.mutate(match.id)}
    />
  );

  return (
    <>
      {match.win ? (
        <Table.Tr>
          <Table.Td>
            {match.teamA.name} vs {match.teamB.name}
          </Table.Td>
          <WinCells match={match} win={match.win} removeMatchButton={removeMatchButton} />
        </Table.Tr>
      ) : (
        <RecordRows match={match} removeMatchButton={removeMatchButton} />
      )}
      {removeMatch.error && (
        <Table.Tr>
          <Table.Td colSpan={6}>
            <ErrorNote error={removeMatch.error} />
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

type Win = NonNullable<Match["win"]>;

/** 記録された勝利の列（勝利チーム・点数・記録・画像・操作）。点数の編集と勝利の削除は、同じ並びに置く */
function WinCells({ match, win, removeMatchButton }: { match: Match; win: Win; removeMatchButton: ReactNode }) {
  const label = `${match.teamA.name} vs ${match.teamB.name}の勝利`;
  const edit = usePointsEditor({ winId: win.id, points: win.points, label });
  const removeWin = useInvalidatingMutation(
    (id: number) => unwrap(api.wins[":id"].active.$put({ param: { id: String(id) }, json: { active: false } })),
    REFRESH,
  );
  return (
    <>
      <Table.Td>
        <Badge color="gray" variant="light" size="lg" tt="none">
          {win.team.name}
        </Badge>
      </Table.Td>
      <Table.Td>{edit.points}</Table.Td>
      <Table.Td c="dimmed">
        {win.recordedByName}・{formatJstDateTime(win.createdAt)}
      </Table.Td>
      <Table.Td>{win.hasScreenshot ? <ScreenshotLink winId={win.id} label="画像" /> : "—"}</Table.Td>
      <Table.Td>
        <Group gap="md" wrap="nowrap" justify="flex-end">
          {edit.actions(
            <Button variant="default" size="xs" w={ACTION_BUTTON_WIDTH} disabled={removeWin.isPending} onClick={() => removeWin.mutate(win.id)} aria-label={`${label}を削除`}>
              削除
            </Button>,
          )}
          {removeMatchButton}
        </Group>
        <ErrorNote error={edit.error ?? removeWin.error} />
      </Table.Td>
    </>
  );
}

/** 選んだ画像のファイル名を、ボタンに収まる長さにする（拡張子は残す） */
const shortName = (name: string) => (name.length <= 12 ? name : `${name.slice(0, 6)}…${name.slice(-5)}`);

/**
 * 勝利がまだない組分け。表の 1 行（1 つのセル）の中に、2 段で出す。
 * 上の段は、組分けの名前と、勝利がまだないこと、組分けの削除。下の段は、勝ったチーム・点数・画像を入力して、勝利を追加する欄。
 * （入力欄を、勝利のある行と同じ列に押し込むと、列の幅が足りず崩れる。段ごとに別の行にすると、触れたときの背景が、段ごとに分かれてしまう）
 */
function RecordRows({ match, removeMatchButton }: { match: Match; removeMatchButton: ReactNode }) {
  const formRef = useRef<HTMLFormElement>(null);
  const resetFile = useRef<() => void>(null);
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
        resetFile.current?.();
        setTeamId("");
        setPoints("");
        setImage(null);
      },
    });
  }

  const label = `${match.teamA.name} vs ${match.teamB.name}`;
  return (
    <Table.Tr>
      <Table.Td colSpan={6}>
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="lg" wrap="nowrap">
              <Text span>{label}</Text>
              <Text span c="dimmed">
                勝利はまだありません
              </Text>
            </Group>
            {removeMatchButton}
          </Group>
          <form ref={formRef} onSubmit={submit} aria-label={`${label}の勝利を追加`}>
            <Group gap="sm" wrap="wrap">
              <NativeSelect aria-label="勝ったチーム" w={170} value={teamId} onChange={(event) => setTeamId(toId(event.target.value))} data={teamOptions([match.teamA, match.teamB], "勝ったチーム")} />
              <TextInput aria-label="点数" placeholder="点数" type="number" min={0} step={1} w={110} value={points} onChange={(event) => setPoints(event.target.value)} />
              <FileButton resetRef={resetFile} onChange={setImage} accept="image/png,image/jpeg,image/webp,image/gif" inputProps={{ "aria-label": "画像" }}>
                {(fileProps) => (
                  <Button variant="default" w={150} {...fileProps} title={image?.name}>
                    {image ? shortName(image.name) : "画像を選択"}
                  </Button>
                )}
              </FileButton>
              <Button type="submit" disabled={!ready || record.isPending}>
                勝利を追加
              </Button>
            </Group>
            <ErrorNote error={record.error} />
          </form>
        </Stack>
      </Table.Td>
    </Table.Tr>
  );
}
