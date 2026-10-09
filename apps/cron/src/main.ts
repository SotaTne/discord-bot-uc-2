import { buildRequests, describeResponse } from "./requests";
import { TARGETS } from "./targets";

/** 毎分、実行される。ステージングと本番の Worker に、cron を起こす POST を送る（片方が失敗しても、もう片方は呼ぶ） */
function tick() {
  const properties = PropertiesService.getScriptProperties();
  const { requests, missing } = buildRequests(TARGETS, (property) => properties.getProperty(property));

  for (const target of missing) console.error(`${target.name}: 合言葉（スクリプトのプロパティ ${target.secretProperty}）が、設定されていません`);
  for (const { target, url, options } of requests) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const line = describeResponse(target, response.getResponseCode(), response.getContentText());
      if (line) console.log(line);
    } catch (error) {
      console.error(`${target.name}: 呼べませんでした ${String(error)}`);
    }
  }
}

/** 毎分のトリガーを作る（すでにあれば、作り直す）。最初に 1 回だけ、手で実行する */
function installTrigger() {
  removeTrigger();
  ScriptApp.newTrigger("tick").timeBased().everyMinutes(1).create();
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
