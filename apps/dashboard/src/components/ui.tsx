import { Alert, Box, Button, CloseButton, Group, Loader, Modal, NativeSelect, Paper, Popover, Stack, Text, TextInput, Title } from "@mantine/core";
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

/** ページの見出し（h1）。どのページも、1 つだけ持つ */
export function PageTitle({ children }: { children: ReactNode }) {
  return <Title order={1}>{children}</Title>;
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper component="section" aria-label={title} className="surface" p="lg">
      <Stack gap="md">
        <Title order={2}>{title}</Title>
        {children}
      </Stack>
    </Paper>
  );
}

/** 取得の状態（読み込み中・失敗）を表示して、成功したときだけ中身を描く */
export function Async<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <Loader size="sm" aria-label="読み込み中…" />;
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
  /** 主な操作として、目立たせる（塗りつぶし） */
  primary?: boolean;
  /** 表の行の中などで、場所を取らないように、×の印のボタンにする（読み上げ用の名前は、label） */
  icon?: boolean;
  description?: string;
  /** ダイアログ（heavy）の中に、説明のあとに出す、追加の部品（チェックなど） */
  extra?: ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  const close = () => setOpened(false);
  const run = () => {
    close();
    props.onConfirm();
  };
  const trigger = props.icon ? (
    <CloseButton
      aria-label={props.label}
      title={props.label}
      {...(props.danger ? { c: "red" } : {})}
      disabled={props.disabled ?? false}
      onClick={() => setOpened((value) => !value)}
    />
  ) : (
    <Button variant={props.primary ? "filled" : props.danger ? "subtle" : "default"} color={props.primary ? "cobalt" : props.danger ? "red" : "gray"} disabled={props.disabled ?? false} onClick={() => setOpened((value) => !value)}>
      {props.label}
    </Button>
  );
  const buttons = (
    <Group gap="xs" wrap="nowrap" justify={props.heavy ? "flex-end" : "flex-start"}>
      <Button variant="default" onClick={close}>
        キャンセル
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
            {props.extra}
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
    <Popover opened={opened} onChange={setOpened} position="bottom-start" withArrow shadow="md">
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" maw={320} role="group" aria-label={`${props.label}の確認`}>
          {props.description && (
            <Text size="sm" c="dimmed">
              {props.description}
            </Text>
          )}
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
      aria-label={props.label}
      w={200}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value === "" ? "" : Number(event.target.value))}
      data={[{ value: "", label: "試合時刻を選択" }, ...props.hours.map((hour) => ({ value: String(hour), label: `${String(hour).padStart(2, "0")}:00` }))]}
    />
  );
}

/**
 * 確認のダイアログ（開き閉じは、呼ぶ側が持つ）。メニューの項目から開く確認に使う。
 * 「実行する」を押して初めて実行される。
 */
export function ConfirmDialog(props: {
  opened: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** 説明と「本当に実行しますか？」のあいだに置くもの（チェックボックスなど） */
  extra?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <Modal opened={props.opened} onClose={props.onClose} title={props.title} centered>
      <Stack gap="md">
        {props.description && <Text size="sm">{props.description}</Text>}
        {props.extra}
        <Text size="sm" fw={600}>
          本当に実行しますか？
        </Text>
        <Group gap="xs" wrap="nowrap" justify="flex-end">
          <Button variant="default" onClick={props.onClose}>
            キャンセル
          </Button>
          <Button
            color="red"
            disabled={props.disabled ?? false}
            onClick={() => {
              props.onClose();
              props.onConfirm();
            }}
          >
            {props.confirmLabel ?? "実行する"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
