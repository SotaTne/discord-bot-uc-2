import { html } from "hono/html";
import type { MockState } from "../state";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const jstIso = (epochMs: number) => new Date(epochMs + JST_OFFSET_MS).toISOString();

/** <input type="datetime-local"> に入れる、JST の日時（秒なし。例: 2026-10-07T20:53） */
export const toJstInputValue = (epochMs: number) => jstIso(epochMs).slice(0, 16);

/** 「20:53」 */
export const jstHm = (epochMs: number) => jstIso(epochMs).slice(11, 16);

/** 「10/07 20:53」 */
export const jstMdHm = (epochMs: number) => `${jstIso(epochMs).slice(5, 10).replace("-", "/")} ${jstHm(epochMs)}`;

/** 「2026-10-07 20:53」 */
export const jstYmdHm = (epochMs: number) => `${jstIso(epochMs).slice(0, 10)} ${jstHm(epochMs)}`;

/** 「21:00」 */
export const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** ユーザー ID を、表示名にする（知らない ID は、そのまま） */
export const userName = (state: MockState, id: string) => state.userById(id)?.username ?? id;

/** `<@&ロールID>` と `<@ユーザーID>` を、名前（@KMU など）に直す。Discord の画面での見え方に近づける */
export function renderMentions(text: string, state: MockState): string {
  return text
    .replace(/<@&(\d+)>/g, (_, id: string) => `@${state.findRole(id)?.name ?? id}`)
    .replace(/<@(\d+)>/g, (_, id: string) => `@${state.userById(id)?.username ?? id}`);
}

/** 行の中の、**太字** と URL を、記号のまま残さずに表示する（それ以外は、文字として、エスケープされる） */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s<>"']+)/g).map((part, index) => {
    if (index % 2 === 0) return part;
    return part.startsWith("**")
      ? html`<strong>${part.slice(2, -2)}</strong>`
      : html`<a href="${part}" target="_blank" rel="noreferrer">${part}</a>`;
  });
}

/**
 * メッセージの本文。Discord の見え方に近づける。
 * - メンションは名前（@KMU）にする
 * - 行頭の # / ## / ### は見出し、「-# 」は補足（小さく薄い字）、**…** は太字、URL はリンクにする
 * - それ以外の HTML は、エスケープされる
 */
export function renderContent(text: string, state: MockState) {
  return renderMentions(text, state)
    .split("\n")
    .map((line) => {
      // 「-# 」で始まる行は、小さく薄い字（補足）
      if (line.startsWith("-# ")) return html`<div class="sub">${renderInline(line.slice(3))}</div>`;
      const heading = /^(#{1,3}) (.*)$/.exec(line);
      if (heading) return html`<div class="h h${heading[1]?.length}">${renderInline(heading[2] ?? "")}</div>`;
      return line === "" ? html`<div class="blank"></div>` : html`<div>${renderInline(line)}</div>`;
    });
}
