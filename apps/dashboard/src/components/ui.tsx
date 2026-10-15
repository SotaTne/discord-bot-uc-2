import { Alert, Box, Button, CloseButton, Group, Loader, Menu, Modal, NativeSelect, Paper, Popover, Stack, Table, Text, TextInput, Title, UnstyledButton } from "@mantine/core";
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
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  return (
    <Modal opened={props.opened} onClose={props.onClose} title={props.title} centered>
      <Stack gap="md">
        {props.description && <Text size="sm">{props.description}</Text>}
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

export type RowMenuItem = { label: string; onClick: () => void; danger?: boolean; disabled?: boolean };

/**
 * 表の行の操作メニュー（「操作 ▾」を押すと開く。「⋯」ではなく、文字を付けて、押せるものだと分かるようにする）。行ごとに、いくつもボタンを並べず、操作は項目の名前で選ぶ。
 * 何を対象にした操作かは、項目の名前に書く（「勝利を削除」「組分けを削除」）。
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button variant="default" size="xs" aria-label={label} rightSection={<span aria-hidden="true">▾</span>}>
          操作
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {items.map((item) => (
          <Menu.Item key={item.label} {...(item.danger ? { color: "red" } : {})} disabled={item.disabled ?? false} onClick={item.onClick}>
            {item.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

export type SortDirection = "asc" | "desc";

/** 並び替えの印。上下の三角を並べ、今の向きだけを濃くする（並べていないときは、両方とも薄い） */
function SortIcon({ direction }: { direction: SortDirection | null }) {
  const active = "var(--mantine-color-indigo-filled)";
  const idle = "var(--mantine-color-dimmed)";
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M5 1 9 6H1z" fill={direction === "asc" ? active : idle} opacity={direction === "asc" ? 1 : 0.45} />
      <path d="M5 13 1 8h8z" fill={direction === "desc" ? active : idle} opacity={direction === "desc" ? 1 : 0.45} />
    </svg>
  );
}

/**
 * 並び替えができる、表の見出し。上下の三角の印が付き、押すと切り替わる（昇順 → 降順 → 元の並び）。
 * 今の並びは、印の濃い側と、見出しの `aria-sort` で伝える。
 */
export function SortableTh(props: { label: string; direction: SortDirection | null; onSort: () => void; align?: "left" | "right" }) {
  const ariaSort = props.direction === "asc" ? "ascending" : props.direction === "desc" ? "descending" : "none";
  return (
    <Table.Th ta={props.align ?? "left"} aria-sort={ariaSort}>
      <UnstyledButton className="sortable" onClick={props.onSort} fw="inherit" fz="inherit" c="inherit">
        <Group gap={6} wrap="nowrap" justify={props.align === "right" ? "flex-end" : "flex-start"}>
          {props.label}
          <SortIcon direction={props.direction} />
        </Group>
      </UnstyledButton>
    </Table.Th>
  );
}

/** 押すたびに、昇順 → 降順 → 元の並び、と切り替える（別の列を押したら、その列の昇順から） */
export function nextSort<K extends string>(current: { key: K; direction: SortDirection } | null, key: K): { key: K; direction: SortDirection } | null {
  if (current?.key !== key) return { key, direction: "asc" };
  return current.direction === "asc" ? { key, direction: "desc" } : null;
}
