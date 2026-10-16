import {
  createSlotHour,
  createTeam,
  type Db,
} from "@uc/db";
import { createTestDb } from "@uc/db/testing";
import { DiscordApiError, type CommandOptionValue, type DiscordRest, type Interaction } from "@uc/discord";
import type { CommandContext } from "./commands/registry";
import type { AppEnv } from "./env";

/** コマンドのテストで使う、決まった ID の登場人物 */
export const GUILD_ID = "200000000000000001";
export const KMU_ROLE = "400000000000000001";
export const UT_ROLE = "400000000000000002";
export const ADMIN_USER = "500000000000000005";
export const ALICE = "500000000000000001"; // KMU
export const BOB = "500000000000000002"; // KMU
export const CAROL = "500000000000000003"; // UT

/** テストの Discord が返す、チームのロールの名前（チームの表示名は、ロールの名前を使う） */
export const ROLE_NAMES: Record<string, string> = { [KMU_ROLE]: "KMU", [UT_ROLE]: "UT", r3: "NGT" };

/** テストの Discord が返す、ユーザーの表示名（ID → 名前） */
export const USER_NAMES: Record<string, string> = {
  [ADMIN_USER]: "管理者さん",
  [ALICE]: "alice",
  [BOB]: "bob",
  [CAROL]: "carol",
};

/** チームの表示名を取るための、Discord の代わり（ロール一覧だけ返す） */
export const fakeRest = {
  getGuildMember: async (_guildId: string, userId: string) => {
    const username = USER_NAMES[userId];
    if (!username) throw new Error("Unknown Member");
    return { nick: null, user: { id: userId, username } };
  },
};

export const fakeRoleRest = {
  getGuildRoles: async (_guildId: string) =>
    Object.entries(ROLE_NAMES).map(([id, name], position) => ({ id, name, position })),
};

/** JST の日時（例: "2026-10-07T15:00:00"）から Date を作る */
export const jst = (text: string) => new Date(`${text}+09:00`);

/** チーム（KMU, UT）と、試合時刻（21, 22, 23 時）を登録したテスト用の DB */
export async function createSeededDb() {
  const db = createTestDb();
  const kmuId = await createTeam(db, { guildId: GUILD_ID, roleId: KMU_ROLE, createdAt: 1 });
  const utId = await createTeam(db, { guildId: GUILD_ID, roleId: UT_ROLE, createdAt: 1 });
  for (const hour of [21, 22, 23]) {
    await createSlotHour(db, { guildId: GUILD_ID, hour, createdAt: 1 });
  }
  return { db, kmuId, utId };
}

type InteractionInput = {
  name?: string;
  /** ボタンなどが押されたときの ID（指定すると、コンポーネントの Interaction になる） */
  customId?: string;
  userId?: string;
  roleIds?: string[];
  permissions?: string;
  options?: CommandOptionValue[];
  guildId?: string | null;
  attachments?: NonNullable<NonNullable<Interaction["data"]>["resolved"]>["attachments"];
};

/** Interaction を作る。既定は、KMU の alice が実行したスラッシュコマンド */
export function commandInteraction(input: InteractionInput): Interaction {
  const data: NonNullable<Interaction["data"]> = { name: input.name ?? "", options: input.options ?? [] };
  if (input.customId) data.custom_id = input.customId;
  if (input.attachments) data.resolved = { attachments: input.attachments };

  const interaction: Interaction = {
    id: "1",
    application_id: "100000000000000001",
    type: input.customId ? 3 : 2,
    token: "test-token",
    channel_id: "300000000000000001",
    member: {
      user: { id: input.userId ?? ALICE, username: "tester" },
      roles: input.roleIds ?? [KMU_ROLE],
      permissions: input.permissions ?? "0",
    },
    data,
  };
  if (input.guildId !== null) interaction.guild_id = input.guildId ?? GUILD_ID;
  return interaction;
}

/** 管理者（Administrator 権限あり）が実行した Interaction */
export const adminInteraction = (input: InteractionInput): Interaction =>
  commandInteraction({ userId: ADMIN_USER, roleIds: [], permissions: "8", ...input });

export const timeOption = (hour: number): CommandOptionValue => ({ name: "time", type: 4, value: hour });


/**
 * チャンネルのメッセージの、編集と削除の、何もしない代わり（投稿だけを確かめるテストで、投稿の偽物に、足して使う）。
 * 編集・削除を確かめるテストは、`createFakeChannel` を使う。
 */
export const channelNoops = {
  editMessage: async (_channelId: string, _messageId: string, _payload: unknown) => ({}),
  deleteMessage: async (_channelId: string, _messageId: string) => ({}),
};

export type FakeChannel = ReturnType<typeof createFakeChannel>;

/**
 * チャンネルへの、投稿・編集・削除を、記録する Discord の偽物。
 * failDelete / failEdit に、HTTP ステータスを渡すと、以降の削除・編集を、そのステータスで失敗させる（404 は「すでにない」、それ以外は「失敗」）。
 */
export function createFakeChannel() {
  const posted: { id: string; channelId: string; content: string; components: unknown; allowedMentions: unknown; replyTo: string | undefined }[] = [];
  const edited: { channelId: string; messageId: string; content: string | undefined; components: unknown }[] = [];
  const deleted: { channelId: string; messageId: string }[] = [];
  const failures: { delete: number | null; edit: number | null } = { delete: null, edit: null };

  const rest = {
    async createMessage(
      channelId: string,
      payload: { content?: string; components?: unknown; allowed_mentions?: unknown; message_reference?: { message_id: string } },
    ) {
      const id = `m${posted.length + 1}`;
      posted.push({
        id,
        channelId,
        content: payload.content ?? "",
        components: payload.components,
        allowedMentions: payload.allowed_mentions,
        replyTo: payload.message_reference?.message_id,
      });
      return { id };
    },
    async editMessage(channelId: string, messageId: string, payload: { content?: string; components?: unknown }) {
      if (failures.edit !== null) throw new DiscordApiError(failures.edit, "failed", `/channels/${channelId}/messages/${messageId}`);
      edited.push({ channelId, messageId, content: payload.content, components: payload.components });
      return {};
    },
    async deleteMessage(channelId: string, messageId: string) {
      if (failures.delete !== null) throw new DiscordApiError(failures.delete, "failed", `/channels/${channelId}/messages/${messageId}`);
      deleted.push({ channelId, messageId });
      return {};
    },
  };

  return {
    rest,
    posted,
    edited,
    deleted,
    /** 以降の削除を、このステータスで失敗させる（null で、元に戻す） */
    failDelete: (status: number | null) => void (failures.delete = status),
    /** 以降の編集を、このステータスで失敗させる（null で、元に戻す） */
    failEdit: (status: number | null) => void (failures.edit = status),
  };
}

export type EditedResponse = { applicationId: string; token: string; content: string };

/** ハンドラーを呼ぶための実行コンテキストと、そこで起きたことの記録 */
export function commandKit(
  db: Db,
  interaction: Interaction,
  now: Date,
  overrides: {
    env?: Partial<AppEnv>;
    fetch?: typeof fetch;
    origin?: string;
    /** 返信の編集を、この HTTP ステータスで順に失敗させる（例: [404, 404] なら、2回失敗して3回目に成功） */
    editFailures?: number[];
    /** チャンネルへの投稿・編集・削除の、記録つきの偽物（指定すると、その rest を使う） */
    channel?: FakeChannel;
  } = {},
) {
  const pending: Promise<unknown>[] = [];
  const edits: EditedResponse[] = [];
  const sleeps: number[] = [];
  const failures = [...(overrides.editFailures ?? [])];

  const rest = {
    ...(overrides.channel?.rest ?? {}),
    editOriginalResponse: async (applicationId: string, token: string, payload: { content?: string }) => {
      const status = failures.shift();
      if (status !== undefined) throw new DiscordApiError(status, "failed", "/webhooks/x/y/messages/@original");
      edits.push({ applicationId, token, content: payload.content ?? "" });
      return {};
    },
  } as unknown as DiscordRest;

  const context: CommandContext = {
    interaction,
    env: { ...overrides.env } as AppEnv,
    db,
    clock: { now: () => new Date(now) },
    rest,
    fetch: overrides.fetch ?? (async () => new Response("no network in tests", { status: 500 })),
    sleep: async (ms) => void sleeps.push(ms),
    origin: overrides.origin ?? "http://localhost:8787",
    waitUntil: (promise) => void pending.push(promise),
  };

  return {
    context,
    edits,
    /** 待った時間（ミリ秒）の記録 */
    sleeps,
    /** waitUntil で登録された処理（deferred の後始末）がすべて終わるのを待つ */
    flush: async () => {
      await Promise.all(pending);
    },
  };
}

/** ハンドラーを直接呼ぶための実行コンテキスト */
export const commandContext = (db: Db, interaction: Interaction, now: Date): CommandContext =>
  commandKit(db, interaction, now).context;

/** 返信の本文だけを取り出す */
export const contentOf = (response: { data?: { content?: string } }) => response.data?.content ?? "";

/** PNG の先頭の 8 バイト。画像の中身の確認（sniffImageType）を通る、最小の「画像」 */
