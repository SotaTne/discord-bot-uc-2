import type { DevSnapshot } from "@uc/api";
import { html } from "hono/html";
import type { MockState } from "../state";
import { renderCommands } from "./forms";
import { renderClock, renderFeed, renderStatePanel } from "./panels";
import { SCRIPT } from "./script";
import { STYLES } from "./styles";

export type PageInput = {
  state: MockState;
  /** worker の状態。取得できなかったときは null（snapshotError に理由） */
  snapshot: DevSnapshot | null;
  snapshotError: string | null;
};

/** 自動で書き換わる表示（id → 中身）。2秒ごとに取り直される */
export async function renderFragments({ state, snapshot, snapshotError }: PageInput): Promise<Record<string, string>> {
  return {
    clock: String(await renderClock(state, snapshot)),
    feed: String(await renderFeed(state)),
    state: String(await renderStatePanel(state, snapshot, snapshotError)),
  };
}

/** 動作確認ページ。値は html テンプレートが自動でエスケープする */
export async function renderPage(input: PageInput) {
  const { state, snapshot } = input;
  const fragments = await renderFragments(input);
  const raw = (markup: string) => html([markup] as unknown as TemplateStringsArray);

  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>疑似 Discord</title>
        <style>${raw(STYLES)}</style>
      </head>
      <body>
        <div id="notice" class="notice error" hidden></div>
        <section class="clockbar">
          <div id="clock" data-fragment>${raw(fragments.clock ?? "")}</div>
        </section>
        <main class="app">
          <div class="left">
            <section>
              <h2>実行者</h2>
              <div id="users" class="chips">
                ${state.users.map(
                  (user, index) => html`<label class="chip"><input type="checkbox" value="${user.id}" data-name="${user.username}" ${index === 0 ? "checked" : ""} /><span>${user.username}</span></label>`,
                )}
              </div>
            </section>

            <section>
              <h2>コマンド</h2>
              ${renderCommands({ slots: snapshot?.slots ?? [21, 22, 23], roles: state.roles })}
            </section>
          </div>

          <div class="right">
            <section>
              <h2>Discord</h2>
              <div id="feed" data-fragment>${raw(fragments.feed ?? "")}</div>
            </section>
            <div id="state" data-fragment>${raw(fragments.state ?? "")}</div>
            <p class="foot"><button type="button" class="link" data-post="/ui/reset" data-fields="{}" data-confirm="挙手・マッチング・得点・ログインと、このページのメッセージ・時計を、すべて初期状態に戻します。よろしいですか？">データを初期化</button></p>
          </div>
        </main>
        <script>${raw(SCRIPT)}</script>
      </body>
    </html>`;
}
