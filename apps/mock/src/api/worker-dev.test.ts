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

  it("tick は、疑似時計があればその時刻を /dev/tick に送り、結果を返す", async () => {
    const { sent, fetchImpl } = fakeWorker(() => ({ ran: ["recruit:2026-10-07"], errors: [] }));
    current.setClock(jst("2026-10-07T12:00:00"));

    const summary = await createWorkerDev({ workerUrl: "http://worker.local", fetch: fetchImpl }, current).tick();

    expect(summary).toEqual({ ran: ["recruit:2026-10-07"], errors: [] });
    expect(sent[0]?.url).toBe("http://worker.local/dev/tick");
    expect(JSON.parse(sent[0]!.body)).toEqual({ now: "2026-10-07T03:00:00.000Z" });
  });

  it("tick は、疑似時計がなければ時刻を送らない。worker が 404（DEV_CLOCK 無効）なら、理由つきで失敗する", async () => {
    const ok = fakeWorker(() => ({ ran: [], errors: [] }));
    await createWorkerDev({ workerUrl: "http://worker.local", fetch: ok.fetchImpl }, current).tick();
    expect(JSON.parse(ok.sent[0]!.body)).toEqual({});

    const notFound: typeof fetch = async () => new Response("{}", { status: 404 });
    await expect(createWorkerDev({ workerUrl: "http://worker.local", fetch: notFound }, current).tick()).rejects.toThrow("DEV_CLOCK");
  });
});
