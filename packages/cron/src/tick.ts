import { buildRequests, describeResponse, type Send, type Target } from "./requests";

/**
 * 1 回分の呼び出し（Apps Script の毎分の tick も、開発の mock の tick も、これを使う）。
 * リクエストを作って、送って、応答を判定する。返すのは、ログに出す行（問題がなければ、空）。
 * 片方の通信が失敗しても、例外にはしない（次の回に、もう一度呼ぶ）
 */
export async function runTick(input: { targets: readonly Target[]; secret: string | null; send: Send }): Promise<string[]> {
  const requests = buildRequests(input.targets, input.secret);
  if (!requests) return ["合言葉（CRON_SECRET）が、設定されていません"];

  try {
    const responses = await input.send(requests);
    return requests.flatMap((request, index) => {
      const response = responses[index];
      const line = response ? describeResponse(request.target, response.status, response.body) : `${request.target.name}: 応答がありません`;
      return line ? [line] : [];
    });
  } catch (error) {
    return [`呼べませんでした ${String(error)}`];
  }
}
