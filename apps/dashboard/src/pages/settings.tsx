import { handupDeadline, formatJstTime } from "@uc/core";
import { HERE_TARGET, type SettingsInput, type SettingsUpdate } from "@uc/api";
import { Alert, Anchor, Badge, Button, Checkbox, Group, Modal, MultiSelect, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Async, ConfirmButton, ErrorNote, HourSelect, PageTitle, Section } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatHour, todayJst } from "../lib/format";
import { validateChannelId, validateCutoffMinutes, validateRecruitHour } from "../lib/settings-validation";
import { useBoard, useInvalidatingMutation, useRoles, useSettings, useSlotHours } from "../lib/queries";
import { Sessions } from "./sessions";

/** 設定は、関わる人・仕組みごとに、別々のセクションにする（投稿と募集 / 試合時刻 / ログイン） */
export function SettingsPage() {
  const settings = useSettings();
  return (
    <>
      <PageTitle>設定</PageTitle>
      <Async query={settings}>
        {(data) => (
          <>
            <PostSettings initial={data} />
          </>
        )}
      </Async>
      <SlotHours />
      <LoginSettings />
      <Sessions />
    </>
  );
}

type SettingsValues = SettingsInput;

/** 設定の保存。API は全項目をまとめて受け取るので、いまの設定に、そのセクションの項目だけを重ねて送る */
function useSaveSettings(initial: SettingsValues) {
  const save = useInvalidatingMutation(
    (values: Partial<SettingsUpdate>) => unwrap(api.settings.$put({ json: { ...initial, ...values } })),
    [["settings"]],
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

/** 通知するロール（複数）と、@here を選ぶ。ロール一覧は、Discord から取る（取れなくても、選んだものは、そのまま見える） */
function MentionTargets({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const roles = useRoles();
  const known = new Map((roles.data?.roles ?? []).map((role) => [role.id, role.name]));
  const data = [
    { value: HERE_TARGET, label: "@here（オンラインの人）" },
    ...(roles.data?.roles ?? []).map((role) => ({ value: role.id, label: role.name })),
    // 一覧にない（消されたロール・一覧を取れなかった）選択済みのものは、ID で見せる
    ...value.filter((id) => id !== HERE_TARGET && !known.has(id)).map((id) => ({ value: id, label: `ロール ${id}` })),
  ];
  return (
    <>
      <MultiSelect aria-label="通知するロール" placeholder="ロールを選ぶ" w={320} searchable clearable data={data} value={value} onChange={onChange} />
      {roles.isError && (
        <Text size="xs" c="dimmed">
          Discord からロール一覧を取得できませんでした（@here は、選べます）
        </Text>
      )}
    </>
  );
}

const MENTION_LABEL = { none: "なし", teams: "チーム全て", roles: "選んだロール" } as const;

/**
 * 募集開始の時刻・締切を変えるときの確認。参加者の行動に、かかわるので、変更を、チャンネルに知らせるかを、選ばせる
 * （打ち間違いを、すぐ直すときに、知らせないでおける）。通知先は、募集開始の投稿と同じ。
 */
function ChangeDialog(props: {
  opened: boolean;
  onClose: () => void;
  recruit: { from: number; to: number } | null;
  cutoff: { from: number; to: number } | null;
  /** 今日の挙手の件数。募集開始を後ろにずらすと、新しい時刻まで、取り消せなくなる */
  handups: number;
  mentionMode: keyof typeof MENTION_LABEL;
  onConfirm: (notify: boolean) => void;
}) {
  const [notify, setNotify] = useState(true);
  // 開くたびに、初期値（知らせる）に戻す
  useEffect(() => {
    if (props.opened) setNotify(true);
  }, [props.opened]);
  const later = props.recruit !== null && props.recruit.to > props.recruit.from;
  return (
    <Modal opened={props.opened} onClose={props.onClose} title="募集開始・締切を変更します" centered>
      <Stack gap="md">
        <Stack gap={2}>
          {props.recruit && <Text size="sm">募集開始: {pad(props.recruit.from)} → {pad(props.recruit.to)}</Text>}
          {props.cutoff && <Text size="sm">締切: 試合の {props.cutoff.from} 分前 → {props.cutoff.to} 分前</Text>}
        </Stack>
        {later && props.handups > 0 && (
          <Alert color="yellow" role="alert" p="xs">
            今日の挙手が {props.handups} 件あります。挙手は残りますが、新しい時刻まで、取り消せません。
          </Alert>
        )}
        <Checkbox
          label="チャンネルに、変更を通知する"
          description={`通知先は、募集開始の投稿と同じです（いまの設定: ${MENTION_LABEL[props.mentionMode]}）`}
          checked={notify}
          onChange={(event) => setNotify(event.currentTarget.checked)}
        />
        <Group gap="xs" wrap="nowrap" justify="flex-end">
          <Button variant="default" onClick={props.onClose}>
            キャンセル
          </Button>
          <Button
            onClick={() => {
              props.onClose();
              props.onConfirm(notify);
            }}
          >
            変更する
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/** Discord への投稿（募集開始・マッチング結果）の設定 */
function PostSettings({ initial }: { initial: SettingsValues }) {
  const slotHours = useSlotHours();
  const [channelId, setChannelId] = useState(initial.channelId ?? "");
  const [recruitHour, setRecruitHour] = useState(String(initial.recruitHour));
  const [cutoffMinutes, setCutoffMinutes] = useState(String(initial.cutoffMinutes));
  const [mentionMode, setMentionMode] = useState(initial.recruitMentionMode);
  const [mentionTargets, setMentionTargets] = useState(initial.recruitMentionTargets);
  const [confirming, setConfirming] = useState(false);
  const save = useSaveSettings(initial);
  // 今日の挙手の件数を、確認に出す
  const board = useBoard(undefined);
  const handupsToday = (board.data?.slots ?? []).reduce((total, slot) => total + slot.handups.length, 0);

  const errors = {
    channelId: validateChannelId(channelId),
    recruitHour: validateRecruitHour(recruitHour),
    cutoffMinutes: validateCutoffMinutes(cutoffMinutes),
  };
  const valid = !errors.channelId && !errors.recruitHour && !errors.cutoffMinutes;
  const dirty =
    channelId.trim() !== (initial.channelId ?? "") ||
    recruitHour.trim() !== String(initial.recruitHour) ||
    cutoffMinutes.trim() !== String(initial.cutoffMinutes) ||
    mentionMode !== initial.recruitMentionMode ||
    mentionTargets.join(",") !== initial.recruitMentionTargets.join(",");

  const recruitChange = valid && Number(recruitHour) !== initial.recruitHour ? { from: initial.recruitHour, to: Number(recruitHour) } : null;
  const cutoffChange = valid && Number(cutoffMinutes) !== initial.cutoffMinutes ? { from: initial.cutoffMinutes, to: Number(cutoffMinutes) } : null;
  const nextChannelId = channelId.trim() === "" ? null : channelId.trim();

  function saveWith(notifyChange: boolean | undefined) {
    save.mutate({
      channelId: nextChannelId,
      recruitHour: Number(recruitHour),
      cutoffMinutes: Number(cutoffMinutes),
      recruitMentionMode: mentionMode,
      // 「ロールを選ぶ」以外のときは、選んだ通知先は、使われない（残しておくと、あとで戻したときに、選び直さなくてよい）
      recruitMentionTargets: mentionTargets,
      ...(notifyChange === undefined ? {} : { notifyChange }),
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    // 募集開始の時刻・締切を変えて、投稿先があるときは、変更を知らせるかを、確認する
    if ((recruitChange || cutoffChange) && nextChannelId) setConfirming(true);
    else saveWith(undefined);
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
          <SettingRow title="募集開始の通知先" description="募集開始の投稿で、誰に通知するか。「なし」が、既定です">
            <Stack gap="xs">
              <SegmentedControl
                aria-label="募集開始の通知先"
                w={320}
                value={mentionMode}
                onChange={(value) => setMentionMode(value as typeof mentionMode)}
                data={[
                  { value: "none", label: "なし" },
                  { value: "teams", label: "チーム全て" },
                  { value: "roles", label: "ロールを選ぶ" },
                ]}
              />
              {mentionMode === "teams" && (
                <Text size="xs" c="dimmed">
                  登録済みのチームのロールに、通知します
                </Text>
              )}
              {mentionMode === "roles" && <MentionTargets value={mentionTargets} onChange={setMentionTargets} />}
            </Stack>
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
        <ChangeDialog
          opened={confirming}
          onClose={() => setConfirming(false)}
          recruit={recruitChange}
          cutoff={cutoffChange}
          handups={handupsToday}
          mentionMode={mentionMode}
          onConfirm={(notify) => saveWith(notify)}
        />
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
              setMentionMode(initial.recruitMentionMode);
              setMentionTargets(initial.recruitMentionTargets);
            }}
          />
          {!dirty && save.data?.notified && (
            <Text size="sm" c="green" role="status">
              チャンネルに、変更を通知しました
            </Text>
          )}
          {save.data?.notifyFailed && (
            <Text size="sm" c="red" role="alert">
              設定は保存しましたが、チャンネルへの通知に失敗しました
            </Text>
          )}
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
