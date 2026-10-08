import { Alert, Anchor, Button, Card, Group, Image, Loader, Modal, NativeSelect, Popover, Stack, Text, TextInput, Title } from "@mantine/core";
import type { UseQueryResult } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { errorMessage, unwrap } from "../lib/errors";
import { useInvalidatingMutation } from "../lib/queries";

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert color="red" role="alert" p="xs">
      {errorMessage(error)}
    </Alert>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card component="section" aria-label={title}>
      <Stack gap="sm">
        <Title order={2} size="h4">
          {title}
        </Title>
        {children}
      </Stack>
    </Card>
  );
}

/** 取得の状態（読み込み中・失敗）を表示して、成功したときだけ中身を描く */
export function Async<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <Loader size="sm" aria-label="読み込み中" />;
  if (query.isError) return <ErrorNote error={query.error} />;
  return <>{children(query.data)}</>;
}

/**
 * 確認が必要な操作のためのボタン。「実行する」を押して初めて実行される。
 * - 既定: ボタンのすぐ下に、確認の吹き出し（ポップオーバー）が出る。どの行の操作か見えたまま確認できる、軽い操作向け。
 * - heavy: 画面の中央に、確認のダイアログが出る。元に戻せない・影響が大きい操作向け。description に、何が起きるかを書く。
 */
export function ConfirmButton(props: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
  heavy?: boolean;
  description?: string;
}) {
  const [opened, setOpened] = useState(false);
  const close = () => setOpened(false);
  const run = () => {
    close();
    props.onConfirm();
  };
  const trigger = (
    <Button variant={props.danger ? "light" : "default"} color={props.danger ? "red" : "gray"} disabled={props.disabled ?? false} onClick={() => setOpened((value) => !value)}>
      {props.label}
    </Button>
  );
  const buttons = (
    <Group gap="xs" wrap="nowrap" justify={props.heavy ? "flex-end" : "flex-start"}>
      <Button variant="default" onClick={close}>
        やめる
      </Button>
      <Button color="red" disabled={props.disabled ?? false} onClick={run}>
        {props.confirmLabel ?? "実行する"}
      </Button>
    </Group>
  );

  if (props.heavy) {
    return (
      <>
        {trigger}
        <Modal opened={opened} onClose={close} title={props.label} centered>
          <Stack gap="md">
            {props.description && <Text size="sm">{props.description}</Text>}
            <Text size="sm" fw={600}>
              本当に実行しますか？
            </Text>
            {buttons}
          </Stack>
        </Modal>
      </>
    );
  }
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" withArrow shadow="md" withinPortal={false}>
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" role="group" aria-label={`${props.label}の確認`}>
          <Text size="sm">本当に実行しますか？</Text>
          {buttons}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

export function HourSelect(props: { value: number | ""; hours: number[]; onChange: (hour: number | "") => void; label: string }) {
  return (
    <NativeSelect
      label={props.label}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value === "" ? "" : Number(event.target.value))}
      data={[{ value: "", label: "選択してください" }, ...props.hours.map((hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }))]}
    />
  );
}

/**
 * 勝利の点数を、その場で直す。「点数の表示（直している間は入力欄）」と「操作のボタン（直す / 保存・やめる）」を分けて返す。
 * 点数は点数の列に、ボタンは、ほかの操作（削除など）と同じ列に、並べるため。勝ったチームと組分けは変わらない。
 */
export function usePointsEditor(input: { winId: number; points: number; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useInvalidatingMutation(
    (value: number) => unwrap(api.wins[":id"].points.$put({ param: { id: String(input.winId) }, json: { points: value } })),
    [["board"], ["wins"], ["scores"]],
  );
  const valid = draft !== null && /^\d+$/.test(draft);
  const submit = () => {
    if (valid) save.mutate(Number(draft), { onSuccess: () => setDraft(null) });
  };

  return {
    points:
      draft === null ? (
        <Text span fw={600}>
          {input.points}pt
        </Text>
      ) : (
        <TextInput
          type="number"
          min={0}
          step={1}
          w={90}
          size="xs"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          aria-label={`${input.label}の点数`}
        />
      ),
    buttons:
      draft === null ? (
        <Button variant="default" onClick={() => setDraft(String(input.points))} aria-label={`${input.label}の点数を直す`}>
          直す
        </Button>
      ) : (
        <>
          <Button disabled={!valid || save.isPending} onClick={submit}>
            保存
          </Button>
          <Button variant="default" onClick={() => setDraft(null)}>
            やめる
          </Button>
        </>
      ),
    error: save.error,
  };
}

/** スクリーンショット。押すと、別のページに移らず、その場のポップアップで大きく表示する */
export function ScreenshotLink({ winId, label }: { winId: number; label: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Anchor component="button" type="button" size="sm" onClick={() => setOpened(true)}>
        {label}
      </Anchor>
      <Modal opened={opened} onClose={() => setOpened(false)} title="スクリーンショット" size="auto" centered>
        <Image src={`/api/screenshots/${winId}`} alt={`勝利#${winId}のスクリーンショット`} mah="80vh" fit="contain" />
      </Modal>
    </>
  );
}
