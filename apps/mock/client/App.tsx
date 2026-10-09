import { Button, Group, Loader, Text, Title } from "@mantine/core";
import { useState } from "react";
import { formOf, useAction } from "./actions";
import { mockApi } from "./api";
import { ClockBar } from "./components/ClockBar";
import { CommandForm } from "./components/CommandForm";
import { Feed } from "./components/Feed";
import { StatePanel } from "./components/StatePanel";
import { UserPicker } from "./components/UserPicker";
import { useMockState } from "./mockState";
import { NoticeProvider } from "./notice";

/** 疑似 Discord の動作確認ページ。時計（目印）・実行者とコマンド（左）・Discord と状態（右） */
export function App() {
  return (
    <NoticeProvider>
      <Screen />
    </NoticeProvider>
  );
}

function Screen() {
  const query = useMockState();
  const [chosen, setChosen] = useState<string[] | null>(null);
  const reset = useAction((form) => mockApi.reset.$post({}, { init: { body: form } }));

  if (query.isPending) return <Loader size="sm" m="xl" aria-label="読み込み中…" />;
  if (query.isError) {
    return (
      <Text role="alert" c="red" m="xl">
        疑似 Discord のサーバーに接続できません: {query.error.message}
      </Text>
    );
  }

  const state = query.data;
  // はじめは、先頭の 1 人。選び直したら、その選択を使う
  const selected = chosen ?? (state.users[0] ? [state.users[0].id] : []);

  return (
    <main className="page">
      <ClockBar state={state} />
      <div className="quad">
        <div className="cell">
          <StatePanel state={state} part="overview" />
        </div>
        <div className="cell">
          <Feed state={state} />
        </div>
        <div className="cell">
          <div className="controls surface">
            <section aria-label="実行者">
              <Title order={2} className="section-title">
                実行者
              </Title>
              <UserPicker users={state.users} selected={selected} onChange={setChosen} />
            </section>
            <section aria-label="コマンド">
              <Title order={2} className="section-title">
                コマンド
              </Title>
              <CommandForm state={state} selectedUsers={selected} />
            </section>
            <Group justify="flex-start">
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                onClick={() => {
                  if (window.confirm("挙手・マッチング・得点・ログインと、このページのメッセージ・時計を、すべて初期状態に戻します。よろしいですか？")) reset.mutate(formOf({}));
                }}
              >
                データを初期化
              </Button>
            </Group>
          </div>
        </div>
        <div className="cell">
          <StatePanel state={state} part="history" />
        </div>
      </div>
    </main>
  );
}
