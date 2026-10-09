import { CRON_INTERVAL_MINUTES, TARGETS, secretPropertyOf } from "./config";
import { buildRequests, describeResponse } from "./requests";

/**
 * 毎分、実行される。ステージングと本番の Worker に、cron を起こす POST を、同時に送る（Worker は、すぐ 202 を返す）。
 * 待ち時間は、いちばん遅い 1 件の分だけで済む（1 日の実行時間の上限に、収めるため）
 */
function tick() {
  const properties = PropertiesService.getScriptProperties();
  const { requests, missing } = buildRequests(TARGETS, (property) => properties.getProperty(property));

  for (const target of missing) console.error(`${target.name}: 合言葉（スクリプトのプロパティ ${secretPropertyOf(target)}）が、設定されていません`);
  if (requests.length === 0) return;

  try {
    const responses = UrlFetchApp.fetchAll(requests.map(({ url, options }) => ({ url, ...options })));
    responses.forEach((response, index) => {
      const line = describeResponse(requests[index]!.target, response.getResponseCode(), response.getContentText());
      if (line) console.error(line);
    });
  } catch (error) {
    // 通信そのものの失敗（名前が引けない など）。次の分に、もう一度呼ぶ
    console.error(`呼べませんでした ${String(error)}`);
  }
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

// Apps Script は、トップレベルの関数の宣言を探して、実行する（エディタの一覧にも、それが出る）。
// 束ねると、関数が束ねの中に入って見えなくなるので、bundle.ts が、同じ名前の宣言を足して、ここから呼ぶ
export { installTrigger, removeTrigger, tick };
