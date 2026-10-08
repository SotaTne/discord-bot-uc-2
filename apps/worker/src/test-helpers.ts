import {
  createSlot,
  createTeam,
  ensureMatchSlot,
  findMatchForTeam,
  insertWin,
  listTeams,
  markMatchSlotMatched,
  matches,
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

/** チーム（KMU, UT）と、試合枠（21, 22, 23 時）を登録したテスト用の DB */
export async function createSeededDb() {
  const db = createTestDb();
  const kmuId = await createTeam(db, { guildId: GUILD_ID, roleId: KMU_ROLE, createdAt: 1 });
  const utId = await createTeam(db, { guildId: GUILD_ID, roleId: UT_ROLE, createdAt: 1 });
  for (const hour of [21, 22, 23]) {
    await createSlot(db, { guildId: GUILD_ID, hour, createdAt: 1 });
  }
  return { db, kmuId, utId };
}

/**
 * テスト用: 勝利を記録する。その日・枠にそのチームの試合がなければ、（マッチング処理済みの枠として）作る。
 * 相手は、ほかのチームのうち、先頭のもの。
 */
export async function insertWinInSlot(
  db: Db,
  input: {
    guildId: string;
    teamId: number;
    slotDate: string;
    slotHour: number;
    points: number;
    screenshotKey: string | null;
    recordedBy: string;
    createdAt: number;
  },
): Promise<number> {
  const { slotDate, slotHour, ...rest } = input;
  let match = await findMatchForTeam(db, { guildId: input.guildId, slotDate, slotHour, teamId: input.teamId });
  if (!match) {
    const slot = await ensureMatchSlot(db, { guildId: input.guildId, slotDate, slotHour, createdAt: input.createdAt });
    await markMatchSlotMatched(db, { id: slot.id, matchedAt: input.createdAt });
    const opponent = (await listTeams(db, input.guildId)).find((team) => team.id !== input.teamId);
    if (!opponent) throw new Error("相手のチームがありません");
    const [row] = await db
      .insert(matches)
      .values({ matchSlotId: slot.id, teamAId: input.teamId, teamBId: opponent.id })
      .returning({ matchId: matches.id });
    match = { matchId: row!.matchId, teamAId: input.teamId, teamBId: opponent.id };
  }
  return insertWin(db, { ...rest, matchId: match.matchId });
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

export type FakeR2Object = { contentType: string | undefined; bytes: number };

/** R2 の代わり。put / get / delete だけを真似る */
export function createFakeR2() {
  const objects = new Map<string, FakeR2Object>();
  const blobs = new Map<string, { contentType: string | undefined; data: ArrayBuffer }>();

  const bucket = {
    put: async (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) => {
      const contentType = options?.httpMetadata?.contentType;
      objects.set(key, { contentType, bytes: value.byteLength });
      blobs.set(key, { contentType, data: value });
    },
    get: async (key: string) => {
      const blob = blobs.get(key);
      if (!blob) return null;
      return { body: new Blob([blob.data]).stream(), httpMetadata: { contentType: blob.contentType } };
    },
    // R2 の delete は、キー1つでも、キーの配列でも受け取る
    delete: async (keys: string | string[]) => {
      for (const key of [keys].flat()) {
        objects.delete(key);
        blobs.delete(key);
      }
    },
  } as unknown as R2Bucket;
  return { bucket, objects };
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
  } = {},
) {
  const pending: Promise<unknown>[] = [];
  const edits: EditedResponse[] = [];
  const sleeps: number[] = [];
  const failures = [...(overrides.editFailures ?? [])];
  const r2 = createFakeR2();

  const rest = {
    editOriginalResponse: async (applicationId: string, token: string, payload: { content?: string }) => {
      const status = failures.shift();
      if (status !== undefined) throw new DiscordApiError(status, "failed", "/webhooks/x/y/messages/@original");
      edits.push({ applicationId, token, content: payload.content ?? "" });
      return {};
    },
  } as unknown as DiscordRest;

  const context: CommandContext = {
    interaction,
    env: { SCREENSHOTS: r2.bucket, ...overrides.env } as AppEnv,
    db,
    clock: { now: () => new Date(now) },
    baseClock: { now: () => new Date(now) },
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
    r2,
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
