/**
 * 疑似 Discord の動作確認ページの見た目。ダッシュボード（apps/dashboard/src/theme.ts）と、同じ決めごとを使う。
 * - 書体は IBM Plex Sans JP、数字は幅をそろえる。強調の色は、コバルト 1 色
 * - 目印は時計の大きな時刻（このページで、いちばん見るもの）
 * - 箱で区切らず、細い線で区切る
 * 画面は、サーバーで文字列から作るので、Mantine（React）は使わず、CSS だけで合わせている。
 */
export const STYLES = `
:root {
  color-scheme: light dark;
  --paper: #f5f6f8; --surface: #ffffff; --ink: #15181f; --muted: #646c7a; --rule: #e1e4ea;
  --accent: #2f54eb; --accent-ink: #ffffff; --accent-soft: #eef3ff;
  --danger: #c2255c; --danger-soft: #fde8ee; --ok: #1e7f4f; --ok-soft: #e3f6ec; --private: #eef3ff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #12151a; --surface: #1a1e25; --ink: #e8eaed; --muted: #98a1b0; --rule: #2b3039;
    --accent: #6d8dfa; --accent-ink: #0d1117; --accent-soft: #1b2438;
    --danger: #f38aa8; --danger-soft: #3f1a27; --ok: #6fd596; --ok-soft: #173424; --private: #1b2438;
  }
}
* { box-sizing: border-box; }
body { margin: 0; font-family: "IBM Plex Sans JP", system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; background: var(--paper); color: var(--ink); line-height: 1.55; font-size: 14px; font-variant-numeric: tabular-nums; -webkit-text-size-adjust: 100%; }
h2 { font-size: 13px; margin: 0 0 10px; color: var(--muted); font-weight: 600; }
section { margin-bottom: 28px; }
button, a, input, select, summary { touch-action: manipulation; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

.app { max-width: 1180px; margin: 0 auto; padding: 8px 16px 32px; display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 40px; align-items: start; }
.left { position: sticky; top: 16px; }
@media (max-width: 860px) { .app { grid-template-columns: 1fr; gap: 24px; } .left { position: static; } }
.muted { color: var(--muted); } .empty { color: var(--muted); margin: 0; }

/* 部品 */
button, input, select { font: inherit; padding: 6px 12px; min-height: 34px; border-radius: 6px; border: 1px solid var(--rule); background: var(--surface); color: var(--ink); }
button { cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--muted); }
button:disabled { opacity: .5; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 500; }
button.primary:hover:not(:disabled) { filter: brightness(1.08); }
button.danger { background: transparent; border-color: var(--danger); color: var(--danger); }
button.wide, input.wide { width: 100%; }
button.link { border: 0; background: none; color: var(--muted); padding: 0; min-height: 0; text-decoration: underline; font-size: 12px; }

/* 時計: このページの目印。大きな時刻を、左に置く */
.clockbar { max-width: 1180px; margin: 0 auto; padding: 24px 16px 20px; }
.clockbar section { margin: 0; }
.clockhead { display: flex; align-items: center; gap: 12px 24px; flex-wrap: wrap; }
.daybar { display: flex; align-items: center; gap: 8px; }
.daybar b { font-weight: 600; font-size: 15px; min-width: 5.5em; text-align: center; }
.day { padding: 2px 10px; }
#clock-time { font-size: 34px; line-height: 1.1; font-weight: 600; letter-spacing: -.01em; padding: 2px 10px; min-height: 0; border-color: transparent; background: transparent; }
#clock-time:hover, #clock-time:focus-visible { border-color: var(--rule); background: var(--surface); }
.steps { display: flex; flex-wrap: wrap; gap: 6px; }
.step { font-size: 12px; padding: 4px 10px; min-height: 28px; }
.step[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 500; }
.now-button { margin-left: auto; }

/* 実行者 */
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { position: relative; }
.chip input { position: absolute; opacity: 0; pointer-events: none; }
.chip span { display: inline-block; padding: 4px 12px; border: 1px solid var(--rule); border-radius: 999px; background: var(--surface); cursor: pointer; }
.chip input:checked + span { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); font-weight: 500; }
.chip input:focus-visible + span { outline: 2px solid var(--accent); outline-offset: 2px; }

/* コマンド */
.tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; }
.tab { padding: 2px 9px; min-height: 28px; font-size: 12px; font-family: ui-monospace, "SF Mono", monospace; border-color: transparent; background: transparent; color: var(--muted); }
.tab small { font-family: inherit; opacity: .8; }
.tab[aria-selected="true"] { background: var(--ink); border-color: var(--ink); color: var(--paper); }
.cmd { display: grid; gap: 12px; padding-top: 4px; }
.cmd[hidden] { display: none; }
.cmd label { display: grid; gap: 4px; font-size: 12px; color: var(--muted); }
.cmd input, .cmd select { width: 100%; color: var(--ink); font-size: 14px; }

.notice { position: fixed; left: 50%; top: 12px; transform: translateX(-50%); z-index: 10; max-width: 90vw; padding: 8px 14px; border-radius: 6px; }
.notice.error { background: var(--danger-soft); color: var(--danger); }
p.notice { position: static; transform: none; }

/* 表 */
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--rule); vertical-align: top; }
th { color: var(--muted); font-weight: 500; font-size: 12px; white-space: nowrap; }
th.num, td.num { text-align: right; padding-right: 0; padding-left: 12px; }

/* Discord: 公開メッセージも、本人にだけ見える返信も、時刻順に 1 本で出す */
.msgs { display: grid; gap: 0; max-height: 360px; overflow: auto; border: 1px solid var(--rule); border-radius: 8px; background: var(--surface); }
.msg { padding: 8px 14px; border-left: 3px solid transparent; }
.msg + .msg { border-top: 1px solid var(--rule); }
.msg.private { background: var(--private); border-left-color: var(--accent); }
.msg .meta { font-size: 11px; color: var(--muted); }
.msg .body > div { overflow-wrap: anywhere; } .msg .blank { height: .6em; } .msg .h { font-weight: 600; margin: 2px 0; } .msg .h1 { font-size: 1.2em; } .msg .h2 { font-size: 1.08em; }
.msg .sub { font-size: 12px; color: var(--muted); }
.msg .actions { display: flex; gap: 6px; margin-top: 8px; }
.log { list-style: none; margin: 0; padding: 0; max-height: 260px; overflow: auto; }
.log li { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--rule); }
.log .when { color: var(--muted); white-space: nowrap; min-width: 7.5em; }
.log li.dim > span:last-child { color: var(--muted); text-decoration: line-through; }

/* 対戦枠（今日）: 時刻と状態を、1 行ずつ。マッチング済みは、緑の印 */
.fixtures { display: grid; gap: 0; border: 1px solid var(--rule); border-radius: 8px; background: var(--surface); }
.fixture { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; font-weight: 500; }
.fixture + .fixture { border-top: 1px solid var(--rule); }
.fixture b { font-size: 18px; font-weight: 600; }
.fixture .status { font-size: 12px; font-weight: 400; color: var(--muted); }
.fixture.matched .status { color: var(--ok); background: var(--ok-soft); padding: 1px 10px; border-radius: 999px; }
.image-link { color: var(--accent); text-decoration: none; cursor: pointer; }
.image-link:hover { text-decoration: underline; }
dialog#image-dialog { border: 1px solid var(--rule); border-radius: 8px; background: var(--surface); color: var(--ink); padding: 12px; max-width: min(92vw, 900px); }
dialog#image-dialog::backdrop { background: rgb(0 0 0 / .45); }
dialog#image-dialog img { display: block; max-width: 100%; max-height: 78vh; margin: 0 auto 12px; object-fit: contain; }
dialog#image-dialog form { text-align: right; }
.foot { margin: 0; text-align: right; }
`;
