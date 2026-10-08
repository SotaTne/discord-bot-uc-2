import { Badge, Button, Checkbox, CloseButton, Group, Stack, Text, TextInput } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { Async, ErrorNote, HourSelect, Section } from "../components/ui";
import { api } from "../lib/api";
import { unwrap } from "../lib/errors";
import { formatHour } from "../lib/format";
import { useInvalidatingMutation, useSettings, useSlots } from "../lib/queries";
import { Sessions } from "./sessions";

/** サーバーの設定・試合の時刻・ログイン中の端末 */
export function SettingsPage() {
  return (
    <>
      <GuildSettings />
      <Slots />
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

function GuildSettings() {
  const settings = useSettings();
  return (
    <Section title="サーバーの設定">
      <Async query={settings}>{(data) => <SettingsForm initial={data} />}</Async>
    </Section>
  );
}

function SettingsForm({ initial }: { initial: SettingsValues }) {
  const [channelId, setChannelId] = useState(initial.channelId ?? "");
  const [recruitHour, setRecruitHour] = useState(String(initial.recruitHour));
  const [cutoffMinutes, setCutoffMinutes] = useState(String(initial.cutoffMinutes));
  const [fixedAfterMatches, setFixedAfterWins] = useState(String(initial.fixedAfterMatches));
  const [fixedPoints, setFixedPoints] = useState(String(initial.fixedPoints));
  const [revoke, setRevoke] = useState(initial.revokeSessionsOnReissue);

  const save = useInvalidatingMutation(
    (values: SettingsValues) => unwrap(api.settings.$put({ json: values })),
    [["settings"], ["scores"]],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({
      channelId: channelId.trim() === "" ? null : channelId.trim(),
      recruitHour: Number(recruitHour),
      cutoffMinutes: Number(cutoffMinutes),
      fixedAfterMatches: Number(fixedAfterMatches),
      fixedPoints: Number(fixedPoints),
      revokeSessionsOnReissue: revoke,
    });
  }

  return (
    <form onSubmit={submit}>
      <Stack maw={520}>
        <TextInput
          label="投稿先のチャンネル ID（募集開始・マッチング結果を投稿する。空だと投稿しない）"
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
          inputMode="numeric"
        />
        <TextInput label="募集を開始する時刻（時, JST）" type="number" min={0} max={23} value={recruitHour} onChange={(event) => setRecruitHour(event.target.value)} />
        <TextInput label="試合の何分前に締め切るか" type="number" min={1} max={180} value={cutoffMinutes} onChange={(event) => setCutoffMinutes(event.target.value)} />
        <TextInput
          label="何試合目までは、勝ったとき、記録した点数で集計するか（それを超えた試合は、固定点）"
          type="number"
          min={0}
          max={100}
          value={fixedAfterMatches}
          onChange={(event) => setFixedAfterWins(event.target.value)}
        />
        <TextInput label="それを超えた試合で勝ったときの、固定の点数" type="number" min={0} value={fixedPoints} onChange={(event) => setFixedPoints(event.target.value)} />
        <Checkbox
          label="ログインリンクを再発行したとき、これまでのログインをすべて無効にする"
          checked={revoke}
          onChange={(event) => setRevoke(event.currentTarget.checked)}
        />
        <Group>
          <Button type="submit" disabled={save.isPending}>
            保存する
          </Button>
          {save.isSuccess && (
            <Text role="status" c="green" size="sm">
              保存しました
            </Text>
          )}
        </Group>
        <ErrorNote error={save.error} />
      </Stack>
    </form>
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
    <Section title="試合枠">
      <Async query={slots}>
        {(data) =>
          data.slots.length === 0 ? (
            <Text c="dimmed">試合枠が登録されていません</Text>
          ) : (
            <Group gap="xs">
              {data.slots.map((slot) => (
                <Badge key={slot.id} size="lg" variant="default" tt="none" rightSection={<CloseButton size="xs" aria-label={`${formatHour(slot.hour)}の枠を削除`} disabled={remove.isPending} onClick={() => remove.mutate(slot.id)} />}>
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
        <Group align="flex-end">
          <HourSelect label="追加する枠" value={hour} hours={candidates} onChange={setHour} />
          <Button type="submit" disabled={hour === "" || add.isPending}>
            追加する
          </Button>
        </Group>
      </form>
      <ErrorNote error={add.error ?? remove.error} />
    </Section>
  );
}
