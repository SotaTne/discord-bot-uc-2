import type { ReactNode } from "react";
import type { MockStateData } from "../mockState";

/** `<@&ロールID>` と `<@ユーザーID>` を、名前（@KMU など）に直す。Discord の画面での見え方に近づける。知らない ID は、そのまま */
export function renderMentions(text: string, state: Pick<MockStateData, "roles" | "users">): string {
  return text
    .replace(/<@&(\d+)>/g, (_, id: string) => `@${state.roles.find((role) => role.id === id)?.name ?? id}`)
    .replace(/<@(\d+)>/g, (_, id: string) => `@${state.users.find((user) => user.id === id)?.username ?? id}`);
}

/** 行の中の、**太字** と URL を、記号のまま残さずに表示する（それ以外は、文字として、そのまま。React が、エスケープする） */
function Inline({ text }: { text: string }): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s<>"']+)/g).map((part, index) => {
    if (index % 2 === 0) return part;
    return part.startsWith("**") ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : (
      <a key={index} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    );
  });
}

/**
 * メッセージの本文。Discord の見え方に近づける。
 * - メンションは名前（@KMU）にする
 * - 行頭の # / ## は見出し、「-# 」は補足（小さく薄い字）、**…** は太字、URL はリンクにする
 */
export function DiscordText({ text, state }: { text: string; state: Pick<MockStateData, "roles" | "users"> }) {
  return (
    <>
      {renderMentions(text, state)
        .split("\n")
        .map((line, index) => {
          if (line === "") return <div key={index} className="blank" />;
          if (line.startsWith("-# ")) return <div key={index} className="line sub"><Inline text={line.slice(3)} /></div>;
          const heading = /^(#{1,3}) (.*)$/.exec(line);
          if (heading) return <div key={index} className={`line h${heading[1]?.length}`}><Inline text={heading[2] ?? ""} /></div>;
          return <div key={index} className="line"><Inline text={line} /></div>;
        })}
    </>
  );
}
