import { isAuthorizedKey, runTick } from "@uc/cron";
import { CRON_INTERVAL_MINUTES, SECRET_PROPERTY, TARGETS } from "./config";

/**
 * 毎分、実行される。ステージングと本番の Worker に、cron を起こす POST を、同時に送る（Worker は、すぐ 202 を返す）。
 * 作り方と判定は @uc/cron（開発の mock と同じ）。ここは、送り方（fetchAll）と、合言葉の読み方（プロパティ）だけ。
 * 待ち時間は、いちばん遅い 1 件の分だけで済む（1 日の実行時間の上限に、収めるため）
 */
function tick() {
  runTick({
    targets: TARGETS,
    secret: PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY),
    send: async (requests) =>
      UrlFetchApp.fetchAll(requests.map(({ url, options }) => ({ url, ...options }))).map((response) => ({
        status: response.getResponseCode(),
        body: response.getContentText(),
      })),
  })
    .then((lines) => lines.forEach((line) => console.error(line)))
    .catch((error) => console.error(String(error)));
}

/** 時間トリガーを作る（すでにあれば、作り直す。間隔は、config.ts）。最初に 1 回だけ、手で実行する */
function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger("tick").timeBased().everyMinutes(CRON_INTERVAL_MINUTES).create();
}

/** cron を止める（使わない期間の節約）。もう一度動かすときは、installTrigger */
function removeTrigger() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === "tick") ScriptApp.deleteTrigger(trigger);
  }
}

/**
 * ウェブアプリ（POST）。CD（.github/workflows/gas-cd.yml）が、デプロイのあとに呼んで、毎分のトリガーがあることを保証する。
 * 合言葉（フォームの key。スクリプトのプロパティ CRON_SECRET と同じ値）が合うときだけ、installTrigger を実行する（何度呼んでも、結果は同じ）。
 * 応答の本文が「ok」なら成功。Apps Script は、ステータスコードを選べないので、本文で伝える
 */
function doPost(event: GoogleAppsScript.Events.DoPost) {
  const expected = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
  if (!isAuthorizedKey(event.parameter.key, expected)) return ContentService.createTextOutput("unauthorized");
  installTrigger();
  return ContentService.createTextOutput("ok");
}

// Apps Script は、トップレベルの関数の宣言を探して、実行する（エディタの一覧にも、それが出る）。
// 束ねると、関数が束ねの中に入って見えなくなるので、bundle.ts が、同じ名前の宣言を足して、ここから呼ぶ
export { doPost, installTrigger, removeTrigger, tick };
