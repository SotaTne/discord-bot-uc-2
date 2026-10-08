/**
 * 画面のスクリプト（ブラウザで動く。ビルドは不要）。
 * - 時計・Discord・状態の表示（data-fragment の要素）を、2秒ごとに取り直す
 * - 実行者は複数選べる。コマンドは、選んだ全員として、順に実行する
 * - 操作はページを読み込み直さずに送る（入力が消えない）。失敗したときだけ、通知を出す
 */
export const SCRIPT = `
(() => {
  const $ = (selector) => document.querySelector(selector);
  const noticeEl = $("#notice");
  const selectedUsers = () => [...document.querySelectorAll("#users input:checked")];

  let noticeTimer;
  function notify(text) {
    noticeEl.textContent = text;
    noticeEl.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { noticeEl.hidden = true; }, 10000);
  }

  async function refresh() {
    try {
      const response = await fetch("/ui/fragments");
      if (!response.ok) return;
      const fragments = await response.json();
      for (const [id, markup] of Object.entries(fragments)) {
        const element = document.getElementById(id);
        // 変わったときだけ書き換える（入力の途中や、スクロールの位置を壊さない）
        // 時刻を入力している間は、書き換えない
        if (id === "clock" && document.activeElement?.id === "clock-time") continue;
        if (element && element.dataset.rendered !== markup) {
          element.innerHTML = markup;
          element.dataset.rendered = markup;
          // 新しいメッセージは、一覧の下に足される。いつも、最新が見えるようにする
          element.querySelectorAll(".msgs").forEach((list) => { list.scrollTop = list.scrollHeight; });
        }
      }
    } catch { /* worker や mock が止まっているときは、次の回に任せる */ }
  }

  async function post(url, body) {
    let result;
    try {
      const response = await fetch(url, { method: "POST", body, headers: { "X-Mock-Ajax": "1" } });
      result = await response.json();
    } catch {
      result = { ok: false, notice: "mock に接続できませんでした" };
    }
    if (!result.ok && result.notice) notify(result.notice);
    await refresh();
    return result;
  }

  // 実行ボタンの表示: だれとして実行するか
  function updateRunButtons() {
    const names = selectedUsers().map((input) => input.dataset.name);
    document.querySelectorAll("[data-run]").forEach((button) => {
      button.disabled = names.length === 0;
      button.textContent = names.length === 0 ? "実行者を選んでください" : names.join("・") + " で実行";
    });
  }

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute("data-send")) return;
    event.preventDefault();
    const users = selectedUsers().map((input) => input.value);
    if (users.length === 0) return;
    const body = new FormData(form);
    body.set("users", users.join(","));
    const button = form.querySelector("[data-run]");
    button.disabled = true;
    post(form.action, body).finally(updateRunButtons);
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const tab = target.closest("[data-cmd]");
    if (tab) {
      document.querySelectorAll("[data-cmd]").forEach((other) => other.setAttribute("aria-selected", String(other === tab)));
      document.querySelectorAll("form[data-send]").forEach((form) => { form.hidden = form.id !== "cmd-" + tab.dataset.cmd; });
      return;
    }

    const element = target.closest("[data-post]");
    if (!element) return;
    event.preventDefault();
    if (element.dataset.confirm && !window.confirm(element.dataset.confirm)) return;
    const body = new FormData();
    for (const [key, value] of Object.entries(JSON.parse(element.dataset.fields || "{}"))) body.set(key, value);
    post(element.dataset.post, body);
  });

  // 時刻の欄を直して確定したら、その時刻にする（cron が動く）
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === "clock-time") {
      if (!target.value) return;
      const body = new FormData();
      body.set("action", "set");
      body.set("value", target.dataset.date + "T" + target.value);
      post("/ui/clock", body).then(() => target.blur());
    } else if (target.closest("#users")) {
      updateRunButtons();
    }
  });

  updateRunButtons();
  setInterval(refresh, 2000);
  refresh();
})();
`;
