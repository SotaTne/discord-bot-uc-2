import { Badge, Button, Checkbox, CloseButton, Group, SimpleGrid, Stack, Text, TextInput } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { Async, ErrorNote, HourSelect, PageTitle, Section } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatHour } from "../lib/format";
import { useInvalidatingMutation, useSettings, useSlots } from "../lib/queries";
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
      <Slots />
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

function SaveRow({ pending, saved, error }: { pending: boolean; saved: boolean; error: unknown }) {
  return (
    <>
      <Group>
        <Button type="submit" disabled={pending}>
          保存する
        </Button>
        {saved && (
          <Text role="status" c="green" size="sm">
            保存しました
          </Text>
        )}
      </Group>
      <ErrorNote error={error} />
    </>
  );
}

/** Discord への投稿（募集開始・マッチング結果）の設定 */
function PostSettings({ initial }: { initial: SettingsValues }) {
  const [channelId, setChannelId] = useState(initial.channelId ?? "");
  const [recruitHour, setRecruitHour] = useState(String(initial.recruitHour));
  const [cutoffMinutes, setCutoffMinutes] = useState(String(initial.cutoffMinutes));
  const save = useSaveSettings(initial);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ channelId: channelId.trim() === "" ? null : channelId.trim(), recruitHour: Number(recruitHour), cutoffMinutes: Number(cutoffMinutes) });
  }

  return (
    <Section title="投稿と募集">
      <form onSubmit={submit}>
        <Stack maw={560}>
          <TextInput
            label="投稿先のチャンネル ID"
            name="channelId"
            spellCheck={false}
            description="募集開始とマッチング結果を投稿します（空にすると投稿しません）"
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
            inputMode="numeric"
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="募集開始時刻（JST）" name="recruitHour" description="この時（0〜23）に募集を始めます" type="number" min={0} max={23} value={recruitHour} onChange={(event) => setRecruitHour(event.target.value)} />
            <TextInput label="締切（試合の何分前）" name="cutoffMinutes" description="この時刻に挙手を締め切ります" type="number" min={1} max={180} value={cutoffMinutes} onChange={(event) => setCutoffMinutes(event.target.value)} />
          </SimpleGrid>
          <SaveRow pending={save.isPending} saved={save.isSuccess} error={save.error} />
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

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ fixedAfterMatches: Number(fixedAfterMatches), fixedPoints: Number(fixedPoints) });
  }

  return (
    <Section title="得点の集計">
      <form onSubmit={submit}>
        <Stack maw={560}>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="N（記録した点数で集計する試合数）"
              name="fixedAfterMatches"
              description="N 試合目までは記録した点数、N+1 試合目からは固定点で集計します"
              type="number"
              min={0}
              max={100}
              value={fixedAfterMatches}
              onChange={(event) => setFixedAfterMatches(event.target.value)}
            />
            <TextInput label="固定点" name="fixedPoints" description="N 試合を超えた試合で勝ったときの点数" type="number" min={0} value={fixedPoints} onChange={(event) => setFixedPoints(event.target.value)} />
          </SimpleGrid>
          <SaveRow pending={save.isPending} saved={save.isSuccess} error={save.error} />
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

function Slots() {
  const slots = useSlots();
  const [hour, setHour] = useState<number | "">("");
  const refresh = [["slots"]];
  const add = useInvalidatingMutation((value: number) => unwrap(api.slots.$post({ json: { hour: value } })), refresh);
  const remove = useInvalidatingMutation((id: number) => unwrap(api.slots[":id"].$delete({ param: { id: String(id) } })), refresh);

  const registered = new Set(slots.data?.slots.map((slot) => slot.hour));
  const candidates = Array.from({ length: 24 }, (_, hourOfDay) => hourOfDay).filter((value) => !registered.has(value));

  return (
    <Section title="試合時刻">
      <Async query={slots}>
        {(data) =>
          data.slots.length === 0 ? (
            <Text c="dimmed">試合時刻が登録されていません</Text>
          ) : (
            <Group gap="xs">
              {data.slots.map((slot) => (
                <Badge key={slot.id} size="lg" variant="default" tt="none" rightSection={<CloseButton size="xs" aria-label={`${formatHour(slot.hour)}の試合時刻を削除`} disabled={remove.isPending} onClick={() => remove.mutate(slot.id)} />}>
                  {formatHour(slot.hour)}
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
