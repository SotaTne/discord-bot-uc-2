import { useEffect, useRef } from "react";
import { formOf, useAction } from "../actions";
import { mockApi } from "../api";
import { userName, type MockMessage, type MockStateData } from "../mockState";
import { jstHm } from "../time";
import { DiscordText } from "./DiscordText";

/**
 * Discord の画面: 公開メッセージも、本人にだけ見える返信も、時刻順に 1 本で出す。新しいメッセージが来たら、末尾へ送る。
 * ボタンは、本人にだけ見える返信なら、その本人として、公開メッセージなら、選んでいる実行者として押す（チームごとに、押せるかが変わるため）。
 */
export function Feed({ state, selectedUsers }: { state: MockStateData; selectedUsers: string[] }) {
  const click = useAction((form) => mockApi.click.$post({}, { init: { body: form } }));
  const scroller = useRef<HTMLDivElement>(null);
  const count = state.messages.length;

  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [count]);

  const press = (message: MockMessage, customId: string) =>
    click.mutate(formOf({ custom_id: customId, message_id: message.id, users: selectedUsers.join(",") }));

  return (
    <div className="discord">
      <div className="discord-head">
        <span className="hash" aria-hidden="true">
          #
        </span>
        マッチング
      </div>
      {count === 0 ? (
        <div className="msgs-empty">
          <span>まだ何もありません</span>
        </div>
      ) : (
        <div ref={scroller} className="msgs" role="log" aria-label="Discord のメッセージ">
          {state.messages.map((message) => (
            <div key={message.id} className={`msg ${message.visibleTo ? "private" : ""}`}>
              <div className="avatar" aria-hidden="true">
                UC
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="msg-head">
                  <span className="author">UC Bot</span>
                  <span className="bot">BOT</span>
                  <time>{jstHm(message.createdAt)}</time>
                  <span className="to">{message.visibleTo ? `${userName(state, message.visibleTo)} だけ` : "全員"}</span>
                </div>
                <div className="body">
                  <DiscordText text={message.content} state={state} />
                </div>
                {message.components?.map((row, rowIndex) => (
                  <div key={rowIndex} className="msg-buttons">
                    {row.components.map((button) => (
                      <button
                        key={button.custom_id}
                        type="button"
                        className={`dc-btn ${button.style === 4 ? "danger" : ""}`}
                        disabled={click.isPending}
                        onClick={() => press(message, button.custom_id)}
                      >
                        {button.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
