import { Button, Group, Text } from "@mantine/core";
import { formOf, useAction } from "../actions";
import { mockApi } from "../api";
import { userName, type MockMessage, type MockStateData } from "../mockState";
import { jstHm } from "../time";
import { DiscordText } from "./DiscordText";

/** Discord の画面: 公開メッセージも、本人にだけ見える返信も、時刻順に 1 本で出す */
export function Feed({ state }: { state: MockStateData }) {
  const click = useAction((form) => mockApi.click.$post({}, { init: { body: form } }));

  if (state.messages.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        まだ何もありません
      </Text>
    );
  }

  const press = (message: MockMessage, customId: string) => click.mutate(formOf({ custom_id: customId, message_id: message.id }));

  return (
    <div className="msgs surface" role="log" aria-label="Discord のメッセージ">
      {state.messages.map((message) => (
        <div key={message.id} className={`msg ${message.visibleTo ? "private" : ""}`}>
          <div className="sub">
            {jstHm(message.createdAt)} · {message.visibleTo ? `${userName(state, message.visibleTo)} だけ` : "全員"}
          </div>
          <div className="body">
            <DiscordText text={message.content} state={state} />
          </div>
          {message.components?.map((row, rowIndex) => (
            <Group key={rowIndex} gap={6} mt={8}>
              {row.components.map((button) => (
                <Button
                  key={button.custom_id}
                  size="compact-sm"
                  variant={button.style === 4 ? "filled" : "default"}
                  color={button.style === 4 ? "red" : "gray"}
                  disabled={click.isPending}
                  onClick={() => press(message, button.custom_id)}
                >
                  {button.label}
                </Button>
              ))}
            </Group>
          ))}
        </div>
      ))}
    </div>
  );
}
