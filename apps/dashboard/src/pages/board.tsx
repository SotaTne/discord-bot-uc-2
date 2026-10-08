import { ActionIcon, Anchor, Badge, Button, CloseButton, FileButton, Group, Input, Modal, NativeSelect, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { MAX_POINTS } from "@uc/api";
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Async, ConfirmButton, ConfirmDialog, ErrorNote, RowMenu, ScreenshotLink, usePointsEditor, type RowMenuItem } from "../components/ui";
import { validatePoints } from "../lib/settings-validation";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatDateWithWeekday, formatHour, formatJstDateTime, shiftDate } from "../lib/format";
import { useBoard, useInvalidatingMutation, useTeams } from "../lib/queries";

/** 対戦枠の画面で更新したあとに、取り直すデータ */
const REFRESH = [["board"], ["wins"], ["scores"]];

/** 得点の集計の規則（N と固定点）。勝利を追加するダイアログが、N 試合を超える試合かどうかの案内に使う */
const RuleContext = createContext<{ fixedAfterMatches: number; fixedPoints: number } | null>(null);

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
            <RuleContext.Provider value={data.rule}>
              <div className="surface">
                {data.slots.map((slot) => (
                  <SlotCard key={slot.hour} date={data.date} slot={slot} />
                ))}
              </div>
            </RuleContext.Provider>
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
          {slot.handups.length === 0 && slot.matched && (
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
          {!slot.matched && (
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
            <Table.ScrollContainer minWidth={820}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>組分け</Table.Th>
                    <Table.Th w={120}>勝利チーム</Table.Th>
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

/**
 * 組分けの 1 行（表の行）。表には、内容だけを出す。操作は、行の右端の「操作 ▾」メニューに、項目の名前で入れる。
 * 勝利があれば、その内容を。なければ、「勝利を追加」のボタンを出す（押すと、入力のダイアログが開く）。
 */
function MatchRow({ match }: { match: Match }) {
  const label = `${match.teamA.name} vs ${match.teamB.name}`;
  const [removing, setRemoving] = useState(false);
  const removeMatch = useInvalidatingMutation(
    (id: number) => unwrap(api.matches[":id"].$delete({ param: { id: String(id) } })),
    REFRESH,
  );
  // 組分けを削除すると、その勝利（削除済みのものも）と画像も消える。確認に、その件数を出す
  const winCount = (match.win ? 1 : 0) + match.deletedWins;
  const removeMatchItem: RowMenuItem = { label: "組分けを削除", danger: true, onClick: () => setRemoving(true) };

  return (
    <>
      <Table.Tr>
        <Table.Td>{label}</Table.Td>
        {match.win ? <WinCells match={match} win={match.win} removeMatchItem={removeMatchItem} /> : <NoWinCells match={match} removeMatchItem={removeMatchItem} />}
      </Table.Tr>
      {removeMatch.error && (
        <Table.Tr>
          <Table.Td colSpan={6}>
            <ErrorNote error={removeMatch.error} />
          </Table.Td>
        </Table.Tr>
      )}
      <ConfirmDialog
        opened={removing}
        onClose={() => setRemoving(false)}
        title={`${label}の組分けを削除`}
        description={winCount > 0 ? `この組分けの勝利（${winCount}件。削除済みも含む）と画像も、あわせて削除します。元に戻せません。` : "この組分けを削除します。"}
        confirmLabel={winCount > 0 ? `勝利${winCount}件も削除して、実行する` : "削除を実行する"}
        disabled={removeMatch.isPending}
        onConfirm={() => removeMatch.mutate(match.id)}
      />
    </>
  );
}

type Win = NonNullable<Match["win"]>;

/** 記録された勝利の列（勝利チーム・点数・記録・画像）と、操作のメニュー */
function WinCells({ match, win, removeMatchItem }: { match: Match; win: Win; removeMatchItem: RowMenuItem }) {
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
        <Group justify="flex-end" wrap="nowrap">
          {edit.controls ?? (
            <RowMenu
              label={`${match.teamA.name} vs ${match.teamB.name}の操作`}
              items={[
                { label: "点数を編集", onClick: edit.start },
                { label: "勝利を削除", onClick: () => removeWin.mutate(win.id), disabled: removeWin.isPending },
                removeMatchItem,
              ]}
            />
          )}
        </Group>
        <ErrorNote error={edit.error ?? removeWin.error} />
      </Table.Td>
    </>
  );
}

/** 勝利がまだない組分けの列。「勝利を追加」と、操作のメニュー */
function NoWinCells({ match, removeMatchItem }: { match: Match; removeMatchItem: RowMenuItem }) {
  const [adding, setAdding] = useState(false);
  const label = `${match.teamA.name} vs ${match.teamB.name}`;
  return (
    <>
      <Table.Td colSpan={4} c="dimmed">
        勝利はまだありません
      </Table.Td>
      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          <Button variant="light" size="xs" onClick={() => setAdding(true)} aria-label={`${label}の勝利を追加`}>
            勝利を追加
          </Button>
          <RowMenu label={`${label}の操作`} items={[removeMatchItem]} />
        </Group>
        <AddWinDialog match={match} opened={adding} onClose={() => setAdding(false)} />
      </Table.Td>
    </>
  );
}

/** 選んだ画像のファイル名を、ボタンに収まる長さにする（拡張子は残す） */
const shortName = (name: string) => (name.length <= 24 ? name : `${name.slice(0, 12)}…${name.slice(-8)}`);

/** 勝利を追加するダイアログ。勝ったチーム・点数・画像を入力する */
function AddWinDialog({ match, opened, onClose }: { match: Match; opened: boolean; onClose: () => void }) {
  const resetFile = useRef<() => void>(null);
  const [teamId, setTeamId] = useState<number | "">("");
  const [points, setPoints] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const record = useInvalidatingMutation(
    (form: FormData) => unwrap(api.matches[":id"].wins.$post({ param: { id: String(match.id) } }, { init: { body: form } })),
    REFRESH,
  );
  const rule = useContext(RuleContext);
  const label = `${match.teamA.name} vs ${match.teamB.name}`;
  // 勝つチームが、その組分けで N 試合目を超えているなら、入力は要らない（固定点で登録される）
  const matchNumber = teamId === "" ? null : teamId === match.teamA.id ? match.matchNumberA : match.matchNumberB;
  const fixed = rule !== null && matchNumber !== null && matchNumber > rule.fixedAfterMatches;
  // 点数の入力が正しくないときは、入力欄の下に、理由を出す（空のときは、まだ入力していないだけなので、出さない）
  const pointsError = fixed || points === "" ? undefined : validatePoints(points);
  const pointsValid = fixed || (points !== "" && pointsError === undefined);
  const ready = teamId !== "" && pointsValid && image !== null;
  // 追加できないとき、足りないものを、ボタンの横に出す
  const missing = [teamId === "" && "勝ったチームを選ぶ", !pointsValid && pointsError === undefined && "点数を入力する", image === null && "画像を選ぶ"].filter((item): item is string => item !== false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const form = new FormData();
    form.set("teamId", String(teamId));
    form.set("points", fixed && rule ? String(rule.fixedPoints) : points);
    form.set("image", image);
    record.mutate(form, {
      onSuccess: () => {
        resetFile.current?.();
        setTeamId("");
        setPoints("");
        setImage(null);
        onClose();
      },
    });
  }

  return (
    <Modal opened={opened} onClose={onClose} title={`${label}の勝利を追加`} centered>
      <form onSubmit={submit} aria-label={`${label}の勝利を追加`}>
        <Stack gap="md">
          <NativeSelect label="勝ったチーム" value={teamId} onChange={(event) => setTeamId(toId(event.target.value))} data={teamOptions([match.teamA, match.teamB], "選択してください")} />
          {fixed && rule ? (
            <TextInput
              label="点数"
              name="points"
              value={`${rule.fixedPoints}`}
              readOnly
              disabled
              description={`${matchNumber} 試合目（N=${rule.fixedAfterMatches} を超えています）。点数は、固定点の ${rule.fixedPoints}pt で登録されます`}
            />
          ) : (
            <TextInput label="点数" name="points" type="number" min={0} max={MAX_POINTS} step={1} value={points} error={pointsError ?? false} onChange={(event) => setPoints(event.target.value)} />
          )}
          <Input.Wrapper label="画像">
            <div>
              <FileButton resetRef={resetFile} onChange={setImage} accept="image/png,image/jpeg,image/webp,image/gif" inputProps={{ "aria-label": "画像" }}>
                {(fileProps) => (
                  <Button variant="default" {...fileProps} title={image?.name}>
                    {image ? shortName(image.name) : "画像を選択"}
                  </Button>
                )}
              </FileButton>
            </div>
          </Input.Wrapper>
          <ErrorNote error={record.error} />
          {/* やめるときは、右上の×・外側を押す・Esc で閉じる（キャンセルのボタンは置かない） */}
          <Group justify="flex-end" gap="xs" wrap="nowrap">
            {!ready && (missing.length > 0 || pointsError) && (
              <Text size="xs" c="dimmed" mr="auto" role="status">
                追加するには、{pointsError ? "点数を直す" : missing.join("・")}
              </Text>
            )}
            <Button type="submit" disabled={!ready || record.isPending}>
              追加
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
