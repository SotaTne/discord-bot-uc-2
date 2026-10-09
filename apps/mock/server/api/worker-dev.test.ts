import { beforeEach, describe, expect, it } from "vitest";
import { createMockState } from "../discord/state";
import { defaultSeed } from "../seed";
import { createWorkerDev } from "./worker-dev";

const state = () => createMockState(defaultSeed());
const jst = (text: string) => Date.parse(`${text}+09:00`);

type Sent = { url: string; body: string; method: string | undefined; headers: unknown };
function fakeWorker(respond: (url: string) => unknown, status = 200) {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    sent.push({ url: String(input), body: String(init?.body), method: init?.method, headers: init?.headers });
    return new Response(JSON.stringify(respond(String(input))), { status });
  };
  return { sent, fetchImpl };
}

describe("createWorkerDev（worker の開発用ルートを呼ぶ）", () => {
  let current = state();
  beforeEach(() => {
    current = state();
  });

  it("tick は、本番の Apps Script と同じに、POST /cron を、合言葉の Bearer つきで呼ぶ（時刻は送らない。時計は、worker が持つ）", async () => {
    const { sent, fetchImpl } = fakeWorker(() => ({ accepted: true }), 202);

    await createWorkerDev({ workerUrl: "http://worker.local", cronSecret: "s3cret", fetch: fetchImpl }, current).tick();

    expect(sent[0]?.url).toBe("http://worker.local/cron");
    expect(sent[0]?.method).toBe("POST");
    expect(sent[0]?.headers).toEqual({ Authorization: "Bearer s3cret" });
  });

  it("202 以外（合言葉の違い・worker が開発のものではない）は、理由つきで失敗する", async () => {
    const unauthorized: typeof fetch = async () => new Response('{"error":"unauthorized"}', { status: 401 });
    await expect(createWorkerDev({ workerUrl: "http://worker.local", cronSecret: "x", fetch: unauthorized }, current).tick()).rejects.toThrow("HTTP 401");

    const notFound: typeof fetch = async () => new Response("{}", { status: 404 });
    await expect(createWorkerDev({ workerUrl: "http://worker.local", cronSecret: "x", fetch: notFound }, current).pushClock()).rejects.toThrow("pnpm dev");
  });

  it("pushClock は、mock の疑似時計の状態を、PUT /dev/clock で伝える", async () => {
    const { sent, fetchImpl } = fakeWorker(() => ({}));
    current.moveTo(jst("2026-10-07T12:00:00"));
    const { offsetMs } = current.clock();

    await createWorkerDev({ workerUrl: "http://worker.local", cronSecret: "x", fetch: fetchImpl }, current).pushClock();

    expect(sent[0]?.url).toBe("http://worker.local/dev/clock");
    expect(JSON.parse(sent[0]!.body)).toEqual({ offsetMs });
  });

  it("fetchSnapshot は、worker の時計が、mock の時計と同じなら、伝え直さない。違えば、伝え直す", async () => {
    const same = fakeWorker(() => ({ clock: { offsetMs: 0 } }));
    await createWorkerDev({ workerUrl: "http://worker.local", cronSecret: "x", fetch: same.fetchImpl }, current).fetchSnapshot();
    expect(same.sent.map((request) => request.url)).toEqual(["http://worker.local/dev/state?guildId=200000000000000001"]);

    current.moveTo(jst("2026-10-07T20:53:00"));
    const different = fakeWorker((url) => (url.includes("/dev/state") ? { clock: { offsetMs: 0 } } : {}));
    await createWorkerDev({ workerUrl: "http://worker.local", cronSecret: "x", fetch: different.fetchImpl }, current).fetchSnapshot();
    expect(different.sent.map((request) => request.url)).toEqual([
      "http://worker.local/dev/state?guildId=200000000000000001",
      "http://worker.local/dev/clock",
    ]);
  });
});
