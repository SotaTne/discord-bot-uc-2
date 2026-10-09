/** 疑似 Discord が持つ状態。開発中のメモリ上にだけ置く */
import type { DevClock } from "@uc/api";
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

export type MockStateOptions = {
  /** 本物の時刻（epoch ミリ秒）。疑似時計の「ずれ」の基準。テストで、固定できる */
  realNow?: () => number;
};

export function createMockState(seed: Seed, options: MockStateOptions = {}) {
  const realNow = options.realNow ?? Date.now;
  const messages: MockMessage[] = [];
  const pending = new Map<string, PendingInteraction>();
  const attachments = new Map<string, MockAttachment>();
  let counter = 0;
  /**
   * 疑似時計。worker が持つ時計と、同じもの（worker に、PUT /dev/clock で伝える）。
   * 「本物の時刻 + ずれ」。移っても、時間は進む（固定はしない）
   */
  let clock: DevClock = { offsetMs: 0 };
  const now = () => realNow() + clock.offsetMs;

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
        createdAt: now(),
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

    /** 疑似時計の状態 */
    clock: (): DevClock => clock,
    setClock: (next: DevClock) => void (clock = next),
    /** いまの時刻（疑似時計の時刻） */
    now,
    /** 本物の時刻 */
    realNow,
    /** その時刻へ移る。そこから、時間は、また進む */
    moveTo(at: number) {
      clock = { offsetMs: at - realNow() };
    },
    /** 日を前後に移る（時刻は、そのまま） */
    shiftDays(days: number) {
      this.moveTo(now() + days * 86_400_000);
    },
    /** 本物の時刻（ずれ 0）に戻す */
    useRealTime() {
      clock = { offsetMs: 0 };
    },

    reset() {
      messages.length = 0;
      pending.clear();
      attachments.clear();
    },
  };
}

export type MockState = ReturnType<typeof createMockState>;
