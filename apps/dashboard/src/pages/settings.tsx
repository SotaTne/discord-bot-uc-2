import { handupDeadline, formatJstTime } from "@uc/core";
import { Anchor, Badge, Button, Checkbox, Group, Stack, Text, TextInput } from "@mantine/core";
import { useState, type FormEvent, type ReactNode } from "react";
import { Async, ConfirmButton, ErrorNote, HourSelect, PageTitle, Section } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatHour, todayJst } from "../lib/format";
import { validateChannelId, validateCutoffMinutes, validateFixedAfterMatches, validateFixedPoints, validateRecruitHour } from "../lib/settings-validation";
import { useBoard, useInvalidatingMutation, useSettings, useSlotHours } from "../lib/queries";
import { Sessions } from "./sessions";

/** 設定は、関わる人・仕組みごとに、別々のセクションにする（投稿と募集 / 得点の集計 / 試合時刻 / ログイン） */
export function SettingsPage() {
  const settings = useSettings();
  return (
    <>
      <PageTitle>設定</PageTitle>
      <Async query={settings}>
        {(data) => (
          <>
            <PostSettings initial={data} />
            <ScoreRule initial={data} />
          </>
        )}
      </Async>
      <SlotHours />
      <LoginSettings />
      <Sessions />
    </>
  );
}

type SettingsValues = {
  channelId: string | null;
  recruitHour: number;
  cutoffMinutes: number;
  fixedAfterMatches: number;
  fixedPoints: number;
  revokeSessionsOnReissue: boolean;
};

/** 設定の保存。API は全項目をまとめて受け取るので、いまの設定に、そのセクションの項目だけを重ねて送る */
function useSaveSettings(initial: SettingsValues) {
  const save = useInvalidatingMutation(
    (values: Partial<SettingsValues>) => unwrap(api.settings.$put({ json: { ...initial, ...values } })),
    [["settings"], ["scores"]],
  );
  return save;
}

/** 設定の 1 項目。左に、項目の名前と説明、右に、入力欄を置く（入力欄ごとに説明を付けると、横に並べたときに、高さがずれるため） */
function SettingRow({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <Text fw={500} size="sm">
          {title}
        </Text>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** 保存の行。変更があって、入力に問題がないときだけ、保存できる。状態（未保存の変更 / 保存した）を、横に出す */
function SaveRow({ pending, saved, dirty, valid, error, onCancel }: { pending: boolean; saved: boolean; dirty: boolean; valid: boolean; error: unknown; onCancel: () => void }) {
  return (
    <>
      <Group>
        <Button type="submit" disabled={pending || !dirty || !valid}>
          保存する
        </Button>
        {dirty && (
          <>
            <Text size="sm" c="dimmed" role="status">
              保存していない変更があります
            </Text>
            {/* 入力を、保存したときの値に戻す。ボタンではなく、文字で出す */}
            <Anchor component="button" type="button" size="sm" onClick={onCancel}>
              キャンセル
            </Anchor>
          </>
        )}
        {!dirty && saved && (
          <Text role="status" c="green" size="sm">
            保存しました
          </Text>
        )}
      </Group>
      <ErrorNote error={error} />
    </>
  );
}

const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** Discord への投稿（募集開始・マッチング結果）の設定 */
function PostSettings({ initial }: { initial: SettingsValues }) {
  const slotHours = useSlotHours();
  const [channelId, setChannelId] = useState(initial.channelId ?? "");
  const [recruitHour, setRecruitHour] = useState(String(initial.recruitHour));
  const [cutoffMinutes, setCutoffMinutes] = useState(String(initial.cutoffMinutes));
  const save = useSaveSettings(initial);

  const errors = {
    channelId: validateChannelId(channelId),
    recruitHour: validateRecruitHour(recruitHour),
    cutoffMinutes: validateCutoffMinutes(cutoffMinutes),
  };
  const valid = !errors.channelId && !errors.recruitHour && !errors.cutoffMinutes;
  const dirty =
    channelId.trim() !== (initial.channelId ?? "") || recruitHour.trim() !== String(initial.recruitHour) || cutoffMinutes.trim() !== String(initial.cutoffMinutes);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    save.mutate({ channelId: channelId.trim() === "" ? null : channelId.trim(), recruitHour: Number(recruitHour), cutoffMinutes: Number(cutoffMinutes) });
  }

  // 今の入力で、今日の予定がどうなるか（保存する前に、確かめられる）
  const today = todayJst();
  const schedule =
    !errors.recruitHour && !errors.cutoffMinutes
      ? (slotHours.data?.slotHours ?? []).map((slotHour) => ({ hour: slotHour.hour, cutoff: formatJstTime(handupDeadline(today, slotHour.hour, Number(cutoffMinutes))) }))
      : null;

  return (
    <Section title="投稿と募集">
      <form onSubmit={submit}>
        <Stack gap={0}>
          <SettingRow title="投稿先のチャンネル" description="募集開始とマッチング結果を投稿します。空にすると、投稿しません">
            <TextInput aria-label="投稿先のチャンネル ID" name="channelId" placeholder="チャンネル ID" spellCheck={false} inputMode="numeric" w={280} value={channelId} error={errors.channelId ?? false} onChange={(event) => setChannelId(event.target.value)} />
          </SettingRow>
          <SettingRow title="募集開始時刻" description="この時（0〜23, JST）に、その日の募集を始めます">
            <TextInput aria-label="募集開始時刻（JST）" name="recruitHour" type="number" min={0} max={23} w={120} value={recruitHour} error={errors.recruitHour ?? false} onChange={(event) => setRecruitHour(event.target.value)} />
          </SettingRow>
          <SettingRow title="締切" description="試合の何分前に、挙手を締め切って、マッチング処理を行うか">
            <TextInput aria-label="締切（試合の何分前）" name="cutoffMinutes" type="number" min={1} max={180} w={120} value={cutoffMinutes} error={errors.cutoffMinutes ?? false} onChange={(event) => setCutoffMinutes(event.target.value)} />
          </SettingRow>
          <SettingRow title="今日の予定" description="いまの入力で計算します（保存する前に確かめられます）">
            {schedule === null ? (
              <Text size="sm" c="dimmed">
                入力を直すと、予定が出ます
              </Text>
            ) : (
              <Stack gap={2} aria-label="今日の予定">
                <Text size="sm">{pad(Number(recruitHour))} に募集を開始</Text>
                {schedule.map((item) => (
                  <Text key={item.hour} size="sm">
                    {pad(item.hour)} の試合は、{item.cutoff} に締切
                  </Text>
                ))}
                {schedule.length === 0 && (
                  <Text size="sm" c="dimmed">
                    試合時刻が登録されていません
                  </Text>
                )}
              </Stack>
            )}
          </SettingRow>
        </Stack>
        <Stack mt="md">
          <SaveRow
            pending={save.isPending}
            saved={save.isSuccess}
            dirty={dirty}
            valid={valid}
            error={save.error}
            onCancel={() => {
              setChannelId(initial.channelId ?? "");
              setRecruitHour(String(initial.recruitHour));
              setCutoffMinutes(String(initial.cutoffMinutes));
            }}
          />
        </Stack>
      </form>
    </Section>
  );
}

/** 得点の集計の規則（N と固定点） */
function ScoreRule({ initial }: { initial: SettingsValues }) {
  const [fixedAfterMatches, setFixedAfterMatches] = useState(String(initial.fixedAfterMatches));
  const [fixedPoints, setFixedPoints] = useState(String(initial.fixedPoints));
  const save = useSaveSettings(initial);

  const errors = { fixedAfterMatches: validateFixedAfterMatches(fixedAfterMatches), fixedPoints: validateFixedPoints(fixedPoints) };
  const valid = !errors.fixedAfterMatches && !errors.fixedPoints;
  const dirty = fixedAfterMatches.trim() !== String(initial.fixedAfterMatches) || fixedPoints.trim() !== String(initial.fixedPoints);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    save.mutate({ fixedAfterMatches: Number(fixedAfterMatches), fixedPoints: Number(fixedPoints) });
  }

  return (
    <Section title="得点の集計">
      <form onSubmit={submit}>
        <Stack gap={0}>
          <SettingRow title="N（記録した点数で集計する試合数）" description="勝ったとき、N 試合目までは、記録した点数で集計します">
            <TextInput aria-label="N（記録した点数で集計する試合数）" name="fixedAfterMatches" type="number" min={0} max={100} w={120} value={fixedAfterMatches} error={errors.fixedAfterMatches ?? false} onChange={(event) => setFixedAfterMatches(event.target.value)} />
          </SettingRow>
          <SettingRow title="固定点" description="N 試合を超えた試合（N+1 試合目から）で勝ったときの点数">
            <TextInput aria-label="固定点" name="fixedPoints" type="number" min={0} w={120} value={fixedPoints} error={errors.fixedPoints ?? false} onChange={(event) => setFixedPoints(event.target.value)} />
          </SettingRow>
          <SettingRow title="集計の例" description="いまの入力で計算します">
            {valid ? (
              <Stack gap={2}>
                <Text size="sm">
                  {Number(fixedAfterMatches) === 0 ? "すべての試合で" : `1〜${fixedAfterMatches} 試合目で勝つと`}、{Number(fixedAfterMatches) === 0 ? "勝つと" : ""}記録した点数
                </Text>
                <Text size="sm">
                  {Number(fixedAfterMatches) + 1} 試合目からは、勝つと {fixedPoints}pt 固定
                </Text>
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                入力を直すと、例が出ます
              </Text>
            )}
          </SettingRow>
        </Stack>
        <Stack mt="md">
          <SaveRow
            pending={save.isPending}
            saved={save.isSuccess}
            dirty={dirty}
            valid={valid}
            error={save.error}
            onCancel={() => {
              setFixedAfterMatches(String(initial.fixedAfterMatches));
              setFixedPoints(String(initial.fixedPoints));
            }}
          />
        </Stack>
      </form>
    </Section>
  );
}

/** ログインに関する設定。切り替えると、その場で保存する */
function LoginSettings() {
  const settings = useSettings();
  return (
    <Section title="ログイン">
      <Async query={settings}>{(data) => <RevokeOnReissue initial={data} />}</Async>
    </Section>
  );
}

function RevokeOnReissue({ initial }: { initial: SettingsValues }) {
  const save = useSaveSettings(initial);
  return (
    <>
      <Checkbox
        label="ログインリンクを再発行したとき、これまでのログインをすべて失効させる"
        checked={initial.revokeSessionsOnReissue}
        disabled={save.isPending}
        onChange={(event) => save.mutate({ revokeSessionsOnReissue: event.currentTarget.checked })}
      />
      <ErrorNote error={save.error} />
    </>
  );
}

/** 試合時刻を削除する前の、確認に出す説明。残るもの・止まるもの・今日の挙手の件数を、書く */
function removeSlotDescription(hour: number, today: { matched: boolean; handups: number } | undefined): string {
  const lines = [
    `${formatHour(hour)}の試合時刻を削除します。この時刻の募集・挙手・マッチングは、今から行われません。`,
    "削除した日（今日）までの対戦枠は、「削除済み」として、対戦枠の画面に残ります。組分けと勝利の記録も、そのまま残ります（削除済みの対戦枠では、マッチング処理と、やり直しはできません）。",
  ];
  if (today && !today.matched && today.handups > 0) lines.push(`今日は、この時刻に、${today.handups}件の挙手が入っています（組まれません）。`);
  lines.push("同じ時刻を追加し直すと、元に戻ります。");
  return lines.join("");
}

function SlotHours() {
  const slotHours = useSlotHours();
  // 今日の挙手の件数を、削除の確認に出す
  const board = useBoard(undefined);
  const [hour, setHour] = useState<number | "">("");
  const refresh = [["slot-hours"], ["board"], ["wins"]];
  const add = useInvalidatingMutation((value: number) => unwrap(api["slot-hours"].$post({ json: { hour: value } })), refresh);
  const remove = useInvalidatingMutation((id: number) => unwrap(api["slot-hours"][":id"].$delete({ param: { id: String(id) } })), refresh);

  const today = (hour: number) => {
    const slot = board.data?.slots.find((candidate) => candidate.hour === hour);
    return slot ? { matched: slot.matched, handups: slot.handups.length } : undefined;
  };
  const registered = new Set(slotHours.data?.slotHours.map((slotHour) => slotHour.hour));
  const candidates = Array.from({ length: 24 }, (_, hourOfDay) => hourOfDay).filter((value) => !registered.has(value));

  return (
    <Section title="試合時刻">
      <Async query={slotHours}>
        {(data) =>
          data.slotHours.length === 0 ? (
            <Text c="dimmed">試合時刻が登録されていません</Text>
          ) : (
            <Group gap="xs">
              {data.slotHours.map((slotHour) => (
                <Badge
                  key={slotHour.id}
                  size="lg"
                  variant="default"
                  tt="none"
                  rightSection={
                    <ConfirmButton
                      icon
                      heavy
                      danger
                      label={`${formatHour(slotHour.hour)}の試合時刻を削除`}
                      confirmLabel="削除する"
                      description={removeSlotDescription(slotHour.hour, today(slotHour.hour))}
                      disabled={remove.isPending}
                      onConfirm={() => remove.mutate(slotHour.id)}
                    />
                  }
                >
                  {formatHour(slotHour.hour)}
                </Badge>
              ))}
            </Group>
          )
        }
      </Async>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (hour !== "") add.mutate(hour, { onSuccess: () => setHour("") });
        }}
      >
        <Group gap="sm">
          <HourSelect label="追加する試合時刻" value={hour} hours={candidates} onChange={setHour} />
          <Button type="submit" disabled={hour === "" || add.isPending}>
            追加する
          </Button>
        </Group>
      </form>
      <ErrorNote error={add.error ?? remove.error} />
    </Section>
  );
}
