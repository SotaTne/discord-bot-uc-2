import { beforeEach, describe, expect, it } from "vitest";
import { createMockState } from "../discord/state";
import { defaultSeed } from "../seed";
import { createWorkerDev } from "./worker-dev";

const state = () => createMockState(defaultSeed());
const jst = (text: string) => Date.parse(`${text}+09:00`);

type Sent = { url: string; body: string };
function fakeWorker(respond: (url: string) => unknown) {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    sent.push({ url: String(input), body: String(init?.body) });
    return new Response(JSON.stringify(respond(String(input))));
  };
  return { sent, fetchImpl };
}

describe("createWorkerDev（worker の開発用ルートを呼ぶ）", () => {
  let current = state();
  beforeEach(() => {
    current = state();
  });

  it("tick は、時刻を送らずに、/dev/tick を呼び、結果を返す（時計は、worker が持つ）", async () => {
    const { sent, fetchImpl } = fakeWorker(() => ({ ran: ["recruit:2026-10-07"], errors: [] }));

    const summary = await createWorkerDev({ workerUrl: "http://worker.local", fetch: fetchImpl }, current).tick();

    expect(summary).toEqual({ ran: ["recruit:2026-10-07"], errors: [] });
    expect(sent[0]?.url).toBe("http://worker.local/dev/tick");
    expect(sent[0]?.body).toBe("undefined"); // ボディなし
  });

  it("worker が 404（開発のビルドではない）なら、理由つきで失敗する", async () => {
    const notFound: typeof fetch = async () => new Response("{}", { status: 404 });

    await expect(createWorkerDev({ workerUrl: "http://worker.local", fetch: notFound }, current).tick()).rejects.toThrow("pnpm dev");
    await expect(createWorkerDev({ workerUrl: "http://worker.local", fetch: notFound }, current).pushClock()).rejects.toThrow("pnpm dev");
  });

  it("pushClock は、mock の疑似時計の状態を、PUT /dev/clock で伝える", async () => {
    const { sent, fetchImpl } = fakeWorker(() => ({}));
    current.moveTo(jst("2026-10-07T12:00:00"));
    const { offsetMs } = current.clock();

    await createWorkerDev({ workerUrl: "http://worker.local", fetch: fetchImpl }, current).pushClock();

    expect(sent[0]?.url).toBe("http://worker.local/dev/clock");
    expect(JSON.parse(sent[0]!.body)).toEqual({ offsetMs });
  });

  it("fetchSnapshot は、worker の時計が、mock の時計と同じなら、伝え直さない。違えば、伝え直す", async () => {
    const same = fakeWorker(() => ({ clock: { offsetMs: 0 } }));
    await createWorkerDev({ workerUrl: "http://worker.local", fetch: same.fetchImpl }, current).fetchSnapshot();
    expect(same.sent.map((request) => request.url)).toEqual(["http://worker.local/dev/state?guildId=200000000000000001"]);

    current.moveTo(jst("2026-10-07T20:53:00"));
    const different = fakeWorker((url) => (url.includes("/dev/state") ? { clock: { offsetMs: 0 } } : {}));
    await createWorkerDev({ workerUrl: "http://worker.local", fetch: different.fetchImpl }, current).fetchSnapshot();
    expect(different.sent.map((request) => request.url)).toEqual([
      "http://worker.local/dev/state?guildId=200000000000000001",
      "http://worker.local/dev/clock",
    ]);
  });
});
