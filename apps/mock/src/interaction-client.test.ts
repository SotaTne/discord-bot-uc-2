import { verifyDiscordSignature, type Interaction } from "@uc/discord";
import { generateDevKeyPair } from "@uc/discord/testing";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createInteractionClient } from "./interaction-client";
import { defaultSeed } from "./seed";
import { createMockState, type MockState } from "./state";

type Sent = { url: string; headers: Record<string, string>; body: string };

let keys: Awaited<ReturnType<typeof generateDevKeyPair>>;
let state: MockState;
let sent: Sent[];

beforeAll(async () => {
  keys = await generateDevKeyPair();
});

beforeEach(() => {
  state = createMockState(defaultSeed());
  sent = [];
});

/** worker の代わりに、リクエストを記録して決まった応答を返す fetch */
const fakeWorker = (responseBody: unknown, status = 200): typeof fetch => async (input, init) => {
  sent.push({
    url: String(input),
    headers: init?.headers as Record<string, string>,
    body: String(init?.body),
  });
  return new Response(JSON.stringify(responseBody), { status });
};

const client = (fetchImpl: typeof fetch) =>
  createInteractionClient(
    {
      workerUrl: "http://localhost:8787/",
      mockUrl: "http://localhost:8788",
      keys,
      applicationId: "100000000000000001",
      fetch: fetchImpl,
      nowSeconds: () => 1_700_000_000,
    },
    state,
  );

const alice = () => state.users[0]!;
const admin = () => state.users[4]!;

describe("createInteractionClient", () => {
  it("worker の /interactions に、本物と同じ形式で署名したリクエストを送る", async () => {
    await client(fakeWorker({ type: 4, data: { content: "ok", flags: 64 } })).sendCommand({
      userId: alice().id,
      name: "uc-handup",
      options: { time: "21" },
    });

    const request = sent[0]!;
    expect(request.url).toBe("http://localhost:8787/interactions");
    await expect(
      verifyDiscordSignature({
        publicKey: keys.publicKeyHex,
        signature: request.headers["X-Signature-Ed25519"]!,
        timestamp: request.headers["X-Signature-Timestamp"]!,
        body: request.body,
      }),
    ).resolves.toBe(true);
  });

  it("実行者のロールと権限、型変換したオプションを含める", async () => {
    await client(fakeWorker({ type: 4, data: { content: "ok" } })).sendCommand({
      userId: alice().id,
      name: "uc-handup",
      options: { time: "21" },
    });

    const interaction = JSON.parse(sent[0]!.body) as Interaction;
    expect(interaction.type).toBe(2);
    expect(interaction.member).toMatchObject({ roles: alice().roleIds, permissions: "0" });
    expect(interaction.data).toEqual({
      name: "uc-handup",
      options: [{ name: "time", type: 4, value: 21 }],
    });
  });

  it("管理者の権限は Administrator のビット（8）になる", async () => {
    await client(fakeWorker({ type: 4, data: { content: "ok" } })).sendCommand({
      userId: admin().id,
      name: "uc-admin-dashboard",
    });
    expect((JSON.parse(sent[0]!.body) as Interaction).member?.permissions).toBe("8");
  });

  it("ロールは名前で指定でき、ID に変換される", async () => {
    await client(fakeWorker({ type: 4, data: { content: "ok" } })).sendCommand({
      userId: admin().id,
      name: "uc-admin-win",
      options: { time: 21, "team-role": "KMU", point: 80, image: state.addAttachment({ filename: "a.png", contentType: "image/png", bytes: new Uint8Array([1]) }).id },
    });

    const interaction = JSON.parse(sent[0]!.body) as Interaction;
    expect(interaction.data?.options?.find((o) => o.name === "team-role")).toEqual({ name: "team-role", type: 8, value: state.findRole("KMU")!.id });
  });

  describe("応答の扱い", () => {
    it("ephemeral の返信は、実行したユーザーにだけ見えるメッセージとして記録する", async () => {
      await client(fakeWorker({ type: 4, data: { content: "受け付けました", flags: 64 } })).sendCommand({
        userId: alice().id,
        name: "uc-status",
      });
      expect(state.messages).toMatchObject([{ content: "受け付けました", visibleTo: alice().id }]);
    });

    it("ephemeral でない返信は、公開メッセージとして記録する", async () => {
      await client(fakeWorker({ type: 4, data: { content: "公開の返信" } })).sendCommand({
        userId: alice().id,
        name: "uc-teams",
      });
      expect(state.messages).toMatchObject([{ content: "公開の返信", visibleTo: null }]);
    });

    it("deferred の応答は、あとの編集で解決できるよう保留にする（メッセージはまだ作らない）", async () => {
      await client(fakeWorker({ type: 5, data: { flags: 64 } })).sendCommand({
        userId: alice().id,
        name: "uc-handup",
        options: { time: 21 },
      });

      const interaction = JSON.parse(sent[0]!.body) as Interaction;
      expect(state.messages).toHaveLength(0);
      expect(state.getPending(interaction.token)).toEqual({
        userId: alice().id,
        channelId: state.channelId,
        ephemeral: true,
      });
    });

    it("worker がエラーを返したら、ステータスだけ返してメッセージは作らない", async () => {
      const result = await client(fakeWorker({ error: "invalid request signature" }, 401)).sendCommand({
        userId: alice().id,
        name: "uc-status",
      });
      expect(result).toEqual({ status: 401, response: undefined });
      expect(state.messages).toHaveLength(0);
    });
  });

  describe("入力の検証", () => {
    const run = (input: Parameters<ReturnType<typeof client>["sendCommand"]>[0]) =>
      client(fakeWorker({ type: 4, data: { content: "ok" } })).sendCommand(input);

    it("知らないユーザー・コマンドは拒否する", async () => {
      await expect(run({ userId: "nobody", name: "uc-status" })).rejects.toThrow("ユーザー");
      await expect(run({ userId: alice().id, name: "uc-unknown" })).rejects.toThrow("コマンド");
    });

    it("必須のオプションがなければ拒否する", async () => {
      await expect(run({ userId: alice().id, name: "uc-handup" })).rejects.toThrow("必須");
    });

    it("コマンドにないオプションは拒否する", async () => {
      await expect(
        run({ userId: alice().id, name: "uc-handup", options: { time: 21, foo: 1 } }),
      ).rejects.toThrow("オプション");
    });

    it("整数でない値・存在しないロールは拒否する", async () => {
      await expect(
        run({ userId: alice().id, name: "uc-handup", options: { time: "abc" } }),
      ).rejects.toThrow("整数");
      await expect(
        run({ userId: admin().id, name: "uc-admin-win", options: { time: 21, "team-role": "なし", point: 80 } }),
      ).rejects.toThrow("ロール");
    });

    it("拒否したときは、worker に何も送らない", async () => {
      await run({ userId: alice().id, name: "uc-handup" }).catch(() => undefined);
      expect(sent).toHaveLength(0);
    });
  });
});
