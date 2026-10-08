import type { Interaction } from "@uc/discord";
import { generateDevKeyPair } from "@uc/discord/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDiscordRestMock } from "./discord-rest";
import { createInteractionClient } from "./interaction-client";
import { defaultSeed } from "./seed";
import { createMockState, type MockState } from "./state";

let keys: Awaited<ReturnType<typeof generateDevKeyPair>>;
let state: MockState;
beforeAll(async () => {
  keys = await generateDevKeyPair();
});
beforeEach(() => {
  state = createMockState(defaultSeed());
});

const jst = (text: string) => Date.parse(`${text}+09:00`);
const admin = () => state.users[4]!;
const alice = () => state.users[0]!;

type Sent = { url: string; headers: Record<string, string>; body: string };

/** worker の代わり。送られたものを記録して、決まった応答を返す */
function fakeWorker(respond: (url: string) => unknown) {
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    sent.push({ url: String(input), headers: init?.headers as Record<string, string>, body: String(init?.body) });
    return new Response(JSON.stringify(respond(String(input))));
  };
  return { sent, fetchImpl };
}

const clientFor = (fetchImpl: typeof fetch) =>
  createInteractionClient(
    { workerUrl: "http://worker.local", mockUrl: "http://mock.local/", keys, applicationId: "100000000000000001", fetch: fetchImpl },
    state,
  );

describe("MockState: 時計・添付ファイル・メッセージの置き換え", () => {
  it("疑似時計を設定すると、その時刻になる。null で本物の時刻に戻る", () => {
    expect(state.clockIso()).toBeNull();

    state.setClock(jst("2026-10-07T20:53:00"));
    expect(state.clockIso()).toBe("2026-10-07T11:53:00.000Z");
    expect(state.now()).toBe(jst("2026-10-07T20:53:00"));

    state.setClock(null);
    expect(state.clockIso()).toBeNull();
  });

  it("添付ファイルを登録して、ID で取り出せる。reset で消える", () => {
    const attachment = state.addAttachment({ filename: "a.png", contentType: "image/png", bytes: new Uint8Array([1, 2]) });

    expect(state.getAttachment(attachment.id)).toMatchObject({ filename: "a.png" });
    state.reset();
    expect(state.getAttachment(attachment.id)).toBeUndefined();
  });

  it("メッセージの本文とボタンを置き換えられる（ボタンなしにもできる）", () => {
    const buttons = [{ type: 1 as const, components: [{ type: 2 as const, style: 4 as const, label: "実行", custom_id: "x:confirm" }] }];
    const message = state.addMessage({ channelId: "c", content: "確認", components: buttons });
    expect(message.components).toEqual(buttons);

    expect(state.replaceMessage(message.id, { content: "完了" })).toBe(true);
    expect(state.messages[0]).toMatchObject({ content: "完了" });
    expect(state.messages[0]?.components).toBeUndefined();
    expect(state.replaceMessage("unknown", { content: "x" })).toBe(false);
  });
});

describe("InteractionClient: 疑似時計・添付ファイル・ボタン・cron", () => {
  it("疑似時計が設定されていれば X-Dev-Now ヘッダーで伝える。なければ付けない", async () => {
    const { sent, fetchImpl } = fakeWorker(() => ({ type: 4, data: { content: "ok" } }));
    const client = clientFor(fetchImpl);

    await client.sendCommand({ userId: alice().id, name: "uc-status" });
    state.setClock(jst("2026-10-07T20:53:00"));
    await client.sendCommand({ userId: alice().id, name: "uc-status" });

    expect(sent[0]?.headers["X-Dev-Now"]).toBeUndefined();
    expect(sent[1]?.headers["X-Dev-Now"]).toBe("2026-10-07T11:53:00.000Z");
  });

  it("添付ファイルのオプションは、worker が取りに来られる URL と一緒に、resolved に入れる", async () => {
    const { sent, fetchImpl } = fakeWorker(() => ({ type: 5, data: { flags: 64 } }));
    const image = state.addAttachment({ filename: "shot.png", contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) });

    await clientFor(fetchImpl).sendCommand({
      userId: admin().id,
      name: "uc-admin-win",
      options: { time: 21, "team-role": "KMU", point: 80, image: image.id },
    });

    const interaction = JSON.parse(sent[0]!.body) as Interaction;
    expect(interaction.data?.options?.find((o) => o.name === "image")).toMatchObject({ type: 11, value: image.id });
    expect(interaction.data?.resolved?.attachments?.[image.id]).toEqual({
      id: image.id,
      url: `http://mock.local/attachments/${image.id}`,
      filename: "shot.png",
      content_type: "image/png",
      size: 3,
    });
  });

  it("存在しない添付ファイルは、worker に送らず拒否する", async () => {
    const { sent, fetchImpl } = fakeWorker(() => ({}));
    await expect(
      clientFor(fetchImpl).sendCommand({
        userId: admin().id,
        name: "uc-admin-win",
        options: { time: 21, "team-role": "KMU", point: 80, image: "nope" },
      }),
    ).rejects.toThrow("添付ファイル");
    expect(sent).toEqual([]);
  });

  it("worker の返信の編集が、応答（考え中）より先に届いても、受け付ける（実際の Discord でも、起こり得る順序）", async () => {
    const rest = createDiscordRestMock(state);
    // worker が、応答を返す前に、返信の編集を送ってくる
    const earlyEdit: typeof fetch = async (_input, init) => {
      const interaction = JSON.parse(String(init?.body)) as Interaction;
      await rest.request(`/webhooks/app/${interaction.token}/messages/@original`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "先に届いた結果" }),
      });
      return new Response(JSON.stringify({ type: 5, data: { flags: 64 } }));
    };

    await clientFor(earlyEdit).sendCommand({ userId: admin().id, name: "uc-admin-score-clear" });

    expect(state.messages).toMatchObject([{ content: "先に届いた結果", visibleTo: admin().id }]);
  });

  it("ボタンつきの返信は、ボタンも一緒にメッセージとして残る", async () => {
    const buttons = [{ type: 1, components: [{ type: 2, style: 4, label: "クリアする", custom_id: "score-clear:confirm" }] }];
    const { fetchImpl } = fakeWorker(() => ({ type: 4, data: { content: "確認", flags: 64, components: buttons } }));

    await clientFor(fetchImpl).sendCommand({ userId: admin().id, name: "uc-admin-score-clear" });

    expect(state.messages[0]).toMatchObject({ content: "確認", visibleTo: admin().id });
    expect(state.messages[0]?.components?.[0]?.components[0]?.custom_id).toBe("score-clear:confirm");
  });

  it("ボタンを押すと、worker に押した人と custom_id を送り、メッセージが置き換わる（ボタンは消える）", async () => {
    const message = state.addMessage({
      channelId: state.channelId,
      content: "確認",
      visibleTo: admin().id,
      components: [{ type: 1, components: [{ type: 2, style: 4, label: "クリアする", custom_id: "score-clear:confirm" }] }],
    });
    const { sent, fetchImpl } = fakeWorker(() => ({ type: 7, data: { content: "クリアしました", components: [] } }));

    const result = await clientFor(fetchImpl).sendComponent({
      userId: admin().id,
      customId: "score-clear:confirm",
      messageId: message.id,
    });

    expect(result.status).toBe(200);
    const interaction = JSON.parse(sent[0]!.body) as Interaction;
    expect(interaction).toMatchObject({ type: 3, data: { custom_id: "score-clear:confirm" }, member: { permissions: "8" } });
    expect(state.messages[0]).toMatchObject({ content: "クリアしました" });
    expect(state.messages[0]?.components).toBeUndefined();
  });

  it("ボタンへの応答が通常のメッセージ（権限がないなど）なら、新しいメッセージとして残る", async () => {
    const { fetchImpl } = fakeWorker(() => ({ type: 4, data: { content: "管理者ではありません", flags: 64 } }));

    await clientFor(fetchImpl).sendComponent({ userId: alice().id, customId: "score-clear:cancel", messageId: "none" });

    expect(state.messages).toMatchObject([{ content: "管理者ではありません", visibleTo: alice().id }]);
  });

  it("tick は、疑似時計があればその時刻を /dev/tick に送り、結果を返す", async () => {
    const { sent, fetchImpl } = fakeWorker(() => ({ ran: ["recruit:2026-10-07"], errors: [] }));
    state.setClock(jst("2026-10-07T12:00:00"));

    const summary = await clientFor(fetchImpl).tick();

    expect(summary).toEqual({ ran: ["recruit:2026-10-07"], errors: [] });
    expect(sent[0]?.url).toBe("http://worker.local/dev/tick");
    expect(JSON.parse(sent[0]!.body)).toEqual({ now: "2026-10-07T03:00:00.000Z" });
  });

  it("tick は、疑似時計がなければ時刻を送らない。worker が 404（DEV_CLOCK 無効）なら、理由つきで失敗する", async () => {
    const ok = fakeWorker(() => ({ ran: [], errors: [] }));
    await clientFor(ok.fetchImpl).tick();
    expect(JSON.parse(ok.sent[0]!.body)).toEqual({});

    const notFound: typeof fetch = async () => new Response("{}", { status: 404 });
    await expect(clientFor(notFound).tick()).rejects.toThrow("DEV_CLOCK");
  });
});
