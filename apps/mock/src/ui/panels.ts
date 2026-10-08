import type { DevSnapshot } from "@uc/api";
import { html } from "hono/html";
import type { MockState } from "../state";
import { clockSteps } from "./clock-steps";
import { hourLabel, jstHm, jstMdHm, renderContent, toJstInputValue, userName } from "./format";

type Snapshot = DevSnapshot | null;

const postButton = (input: { url: string; fields: Record<string, string>; label: string; className?: string; confirm?: string }) =>
  html`<button type="button" class="${input.className ?? ""}" data-post="${input.url}" data-fields="${JSON.stringify(input.fields)}" ${input.confirm ? html`data-confirm="${input.confirm}"` : ""}>${input.label}</button>`;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/**
 * 時計: 日付（1日ずつ前後）・時刻（直せる）・イベントの時刻へ移るボタン・現在時刻。
 * 時計を動かすと、cron が自動で動く。
 */
export function renderClock(state: MockState, snapshot: Snapshot) {
  const nowMs = state.now();
  const real = state.clockIso() === null;
  const date = toJstInputValue(nowMs).slice(0, 10);
  const weekday = WEEKDAYS[new Date(nowMs + JST_OFFSET_MS).getUTCDay()];
  const button = (label: string, fields: Record<string, string>, extra: { className?: string; pressed?: boolean; aria?: string }) =>
    html`<button type="button" class="${extra.className ?? ""}" ${extra.aria ? html`aria-label="${extra.aria}"` : ""} ${extra.pressed === undefined ? "" : html`aria-pressed="${extra.pressed ? "true" : "false"}"`} data-post="/ui/clock" data-fields="${JSON.stringify(fields)}">${label}</button>`;

  return html`<div class="clockhead">
    <div class="daybar">
      ${button("◀", { action: "day", value: "-1" }, { className: "day", aria: "前の日" })}
      <b>${jstMdHm(nowMs).slice(0, 5)}（${weekday}）</b>
      ${button("▶", { action: "day", value: "1" }, { className: "day", aria: "次の日" })}
    </div>
    <input id="clock-time" type="time" value="${jstHm(nowMs)}" data-date="${date}" aria-label="いまの時刻" />
    <div class="steps">
      ${clockSteps(snapshot).map((step) =>
        button(step.label, { action: "set", value: `${date}T${jstHm(step.at)}` }, { className: "step", pressed: jstHm(step.at) === jstHm(nowMs) }),
      )}
    </div>
    ${button("現在時刻", { action: "real" }, { className: "step now-button", pressed: real })}
  </div>`;
}

/** Discord の画面: 公開メッセージも、本人にだけ見える返信も、時刻順に1本で出す */
export function renderFeed(state: MockState) {
  if (state.messages.length === 0) return html`<p class="empty">まだ何もありません</p>`;

  return html`<div class="msgs">
    ${state.messages.map(
      (message) => html`<div class="msg ${message.visibleTo ? "private" : ""}">
        <div class="meta">${jstHm(message.createdAt)} · ${message.visibleTo ? `${userName(state, message.visibleTo)} だけ` : "全員"}</div>
        <div class="body">${renderContent(message.content, state)}</div>
        ${message.components?.map(
          (row) => html`<div class="actions">
            ${row.components.map((button) =>
              postButton({
                url: "/ui/click",
                fields: { custom_id: button.custom_id, message_id: message.id },
                label: button.label,
                className: button.style === 4 ? "danger" : "",
              }),
            )}
          </div>`,
        )}
      </div>`,
    )}
  </div>`;
}

/** 状態: チームごとの 挙手中・対戦数・勝利数・得点、マッチングログ、勝利ログ */
export function renderStatePanel(state: MockState, snapshot: Snapshot, error: string | null) {
  if (!snapshot) {
    return html`<p class="notice error">worker の状態を取得できません: ${error ?? "不明なエラー"}</p>`;
  }

  const who = (id: string) => userName(state, id);
  const handupsOf = (teamId: number) =>
    snapshot.handups.filter((handup) => handup.teamId === teamId).sort((a, b) => a.slotHour - b.slotHour);
  const slotText = (date: string | null, hour: number | null) => (date ? `${date.slice(5).replace("-", "/")} ${hourLabel(hour ?? 0)}` : "");

  const matchedHours = new Set(snapshot.matchSlots.filter((slot) => slot.status === "matched").map((slot) => slot.slotHour));

  return html`
    <section>
      <h2>対戦枠（今日）</h2>
      <div class="fixtures">
        ${snapshot.slots.map(
          (hour) => html`<span class="fixture ${matchedHours.has(hour) ? "matched" : ""}">${hourLabel(hour)} ${matchedHours.has(hour) ? "マッチング済み" : "未マッチング"}</span>`,
        )}
      </div>
    </section>

    <section>
      <h2>チーム</h2>
      <table>
        <thead><tr><th>チーム</th><th>挙手中</th><th class="num">対戦</th><th class="num">勝利</th><th class="num">得点</th></tr></thead>
        <tbody>
          ${snapshot.teamStats.map(
            (team) => html`<tr>
              <td>${team.name}</td>
              <td>${handupsOf(team.teamId).map((handup) => html`<div>${hourLabel(handup.slotHour)} <span class="muted">${who(handup.raisedBy)}</span></div>`)}</td>
              <td class="num">${team.matches}</td>
              <td class="num">${team.wins}</td>
              <td class="num">${team.total}</td>
            </tr>`,
          )}
        </tbody>
      </table>
    </section>

    <section>
      <h2>マッチングログ</h2>
      ${snapshot.rounds.length === 0
        ? html`<p class="empty">まだありません</p>`
        : html`<ul class="log">
            ${snapshot.rounds.map(
              (round) => html`<li>
                <span class="when">${slotText(round.slotDate, round.slotHour)}</span>
                <span>${round.pairs.length > 0 ? round.pairs.map((pair) => html`<div><b>${pair.a}</b> vs <b>${pair.b}</b></div>`) : html`<span class="muted">組めず</span>`}${round.excluded ? html`<div class="muted">除外 ${round.excluded}</div>` : ""}</span>
              </li>`,
            )}
          </ul>`}
    </section>

    <section>
      <h2>勝利ログ</h2>
      ${snapshot.wins.length === 0
        ? html`<p class="empty">まだありません</p>`
        : html`<ul class="log">
            ${snapshot.wins.map(
              (win) => html`<li class="${win.active ? "" : "dim"}">
                <span class="when">${slotText(win.slotDate, win.slotHour)}</span>
                <span>
                  <div>${win.match.a} vs ${win.match.b}</div>
                  <div><b>${win.teamName}</b> の勝利 ${win.points}${win.countedPoints !== null && win.countedPoints !== win.points ? html` → <b>${win.countedPoints}</b>` : ""}pt${win.matchNumber !== null ? ` · ${win.matchNumber}試合目` : ""}${win.active ? "" : "（無効）"}${win.hasScreenshot ? html` <a href="/ui/screenshot/${win.id}" target="_blank" rel="noreferrer">画像</a>` : ""}</div>
                </span>
              </li>`,
            )}
          </ul>`}
    </section>
  `;
}
