/** 疑似 Discord が持つ状態。開発中のメモリ上にだけ置く */
import type { ActionRow } from "@uc/discord";

export type MockUser = {
  id: string;
  username: string;
  /** 持っているロールの ID */
  roleIds: string[];
  isAdmin: boolean;
};

export type MockRole = { id: string; name: string; position: number };

export type MockMessage = {
  id: string;
  channelId: string;
  content: string;
  createdAt: number;
  /** 本人にだけ見えるメッセージ（ephemeral）なら、そのユーザーの ID。公開なら null */
  visibleTo: string | null;
  /** ボタン（確認ボタンなど）。押すと、メッセージが置き換わって消える */
  components?: ActionRow[];
};

export type MockAttachment = { id: string; filename: string; contentType: string; bytes: Uint8Array<ArrayBuffer> };

export type Seed = {
  guildId: string;
  channelId: string;
  users: MockUser[];
  roles: MockRole[];
};

type PendingInteraction = { userId: string; channelId: string; ephemeral: boolean };

export function createMockState(seed: Seed) {
  const messages: MockMessage[] = [];
  const pending = new Map<string, PendingInteraction>();
  const attachments = new Map<string, MockAttachment>();
  let counter = 0;
  /** 疑似時計。null なら本物の時刻 */
  let fixedAt: number | null = null;

  const newId = () => String(900_000_000_000_000_000n + BigInt(++counter));

  return {
    guildId: seed.guildId,
    channelId: seed.channelId,
    users: seed.users,
    roles: seed.roles,
    messages,

    newId,

    userById: (id: string) => seed.users.find((user) => user.id === id),
    /** ロールを、名前または ID で引く */
    findRole: (nameOrId: string) =>
      seed.roles.find((role) => role.id === nameOrId || role.name === nameOrId),

    addMessage(input: {
      channelId: string;
      content: string;
      visibleTo?: string | null;
      components?: ActionRow[] | undefined;
    }): MockMessage {
      const message: MockMessage = {
        id: newId(),
        channelId: input.channelId,
        content: input.content,
        createdAt: fixedAt ?? Date.now(),
        visibleTo: input.visibleTo ?? null,
      };
      if (input.components && input.components.length > 0) message.components = input.components;
      messages.push(message);
      return message;
    },

    /** メッセージの本文とボタンを置き換える（ボタンが押されたときの UpdateMessage） */
    replaceMessage(id: string, input: { content: string; components?: ActionRow[] | undefined }): boolean {
      const message = messages.find((m) => m.id === id);
      if (!message) return false;
      message.content = input.content;
      if (input.components && input.components.length > 0) message.components = input.components;
      else delete message.components;
      return true;
    },

    /** そのユーザーに見えるメッセージ（公開 + そのユーザー宛ての ephemeral） */
    messagesVisibleTo: (userId: string) =>
      messages.filter((message) => message.visibleTo === null || message.visibleTo === userId),

    /** deferred で返したインタラクションを、あとの編集で解決できるように覚えておく */
    markPending: (token: string, interaction: PendingInteraction) => void pending.set(token, interaction),
    getPending: (token: string) => pending.get(token),

    /** アップロードされた画像（コマンドの添付ファイルとして、worker が URL から取得する） */
    addAttachment(input: Omit<MockAttachment, "id">): MockAttachment {
      const attachment = { id: newId(), ...input };
      attachments.set(attachment.id, attachment);
      return attachment;
    },
    getAttachment: (id: string) => attachments.get(id),

    /** 疑似時計。null で本物の時刻に戻す */
    setClock: (at: number | null) => void (fixedAt = at),
    /** 疑似時計の時刻（ISO 8601）。本物の時刻のときは null */
    clockIso: () => (fixedAt === null ? null : new Date(fixedAt).toISOString()),
    /** いまの時刻（疑似時計があればそれ） */
    now: () => fixedAt ?? Date.now(),

    reset() {
      messages.length = 0;
      pending.clear();
      attachments.clear();
    },
  };
}

export type MockState = ReturnType<typeof createMockState>;
