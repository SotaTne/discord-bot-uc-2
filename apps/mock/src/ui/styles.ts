export const STYLES = `
:root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --text:#1c2024; --muted:#7a838d; --line:#e3e6ea; --primary:#3b5bdb; --err:#b02a52; --err-bg:#fde8ee; --priv:#eef4ff; }
@media (prefers-color-scheme: dark) { :root { --bg:#14161a; --card:#1d2026; --text:#e8eaed; --muted:#8f98a3; --line:#333842; --primary:#7c93f5; --err:#f38aa8; --err-bg:#3f1a27; --priv:#1b2438; } }
* { box-sizing: border-box; }
body { margin:0; font-family: system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif; background:var(--bg); color:var(--text); line-height:1.5; font-size:14px; }
h2 { font-size:12px; margin:0 0 8px; color:var(--muted); font-weight:600; letter-spacing:.04em; }
section { margin-bottom:24px; }
.app { max-width:1180px; margin:0 auto; padding:20px 16px; display:grid; grid-template-columns:320px minmax(0,1fr); gap:32px; align-items:start; }
.left { position:sticky; top:20px; }
@media (max-width: 860px) { .app { grid-template-columns:1fr; } .left { position:static; } }
.muted { color:var(--muted); } .empty { color:var(--muted); margin:0; }
button, input, select { font:inherit; padding:6px 10px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--text); }
button { cursor:pointer; } button:disabled { opacity:.5; cursor:not-allowed; }
button.primary { background:var(--primary); border-color:var(--primary); color:#fff; }
button.danger { background:var(--err); border-color:var(--err); color:#fff; }
button.wide, input.wide { width:100%; }
button.link { border:0; background:none; color:var(--muted); padding:0; text-decoration:underline; font-size:12px; }
.clockbar { max-width:1180px; margin:0 auto; padding:20px 16px 0; }
.clockhead { display:flex; align-items:center; gap:12px 20px; flex-wrap:wrap; }
.daybar { display:flex; align-items:center; gap:8px; }
.day { padding:2px 8px; }
#clock-time { font-size:26px; font-weight:700; font-variant-numeric:tabular-nums; padding:2px 8px; }
.steps { display:flex; flex-wrap:wrap; gap:6px; }
.step[aria-pressed="true"] { background:var(--primary); border-color:var(--primary); color:#fff; }
.now-button { margin-left:auto; }
.chips { display:flex; flex-wrap:wrap; gap:6px; }
.chip input { position:absolute; opacity:0; pointer-events:none; }
.chip span { display:inline-block; padding:4px 12px; border:1px solid var(--line); border-radius:999px; background:var(--card); cursor:pointer; }
.chip input:checked + span { background:var(--primary); border-color:var(--primary); color:#fff; }
.chip input:focus-visible + span { outline:2px solid var(--primary); outline-offset:2px; }
.tabs { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:10px; }
.tab { padding:3px 9px; font-size:12px; font-family:ui-monospace,monospace; border-radius:6px; }
.tab small { color:var(--muted); font-family:inherit; }
.tab[aria-selected="true"] { background:var(--text); border-color:var(--text); color:var(--bg); }
.tab[aria-selected="true"] small { color:inherit; opacity:.7; }
.cmd { display:grid; gap:10px; }
.cmd[hidden] { display:none; }
.cmd label { display:grid; gap:3px; font-size:12px; color:var(--muted); }
.cmd input, .cmd select { width:100%; color:var(--text); font-size:14px; }
.notice { position:fixed; left:50%; top:12px; transform:translateX(-50%); z-index:10; max-width:90vw; padding:8px 14px; border-radius:8px; }
.notice.error { background:var(--err-bg); color:var(--err); }
p.notice { position:static; transform:none; }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:6px 8px 6px 0; border-bottom:1px solid var(--line); vertical-align:top; }
th { color:var(--muted); font-weight:500; font-size:12px; white-space:nowrap; }
th.num, td.num { text-align:right; font-variant-numeric:tabular-nums; }
.msgs { display:grid; gap:6px; max-height:320px; overflow:auto; padding-right:4px; }
.msg { border:1px solid var(--line); border-radius:10px; padding:6px 10px; background:var(--card); }
.msg.private { background:var(--priv); border-color:transparent; }
.msg .meta { font-size:11px; color:var(--muted); }
.msg .body > div { overflow-wrap:anywhere; } .msg .blank { height:.6em; } .msg .h { font-weight:700; margin:2px 0; } .msg .h1 { font-size:1.25em; } .msg .h2 { font-size:1.12em; }
.msg .actions { display:flex; gap:6px; margin-top:6px; }
.log { list-style:none; margin:0; padding:0; max-height:240px; overflow:auto; }
.log li { display:flex; gap:12px; padding:6px 0; border-bottom:1px solid var(--line); }
.log .when { color:var(--muted); white-space:nowrap; min-width:7.5em; font-variant-numeric:tabular-nums; }
.log li.dim > span:last-child { color:var(--muted); text-decoration:line-through; }
.fixtures { display:flex; flex-wrap:wrap; gap:6px; }
.fixture { padding:3px 10px; border:1px solid var(--line); border-radius:999px; background:var(--card); }
.fixture.matched { background:var(--text); border-color:var(--text); color:var(--bg); }
.foot { margin:0; text-align:right; }
`;
