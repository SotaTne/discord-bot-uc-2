import { z } from "zod";

// worker の入力検証と、ダッシュボードのフォーム検証で同じルールを使うためのスキーマ。
// 型は z.infer で取り出す。API の戻り値の型は Hono RPC で共有するので、ここには置かない。

/** 試合開始時刻（JST の時） */
export const hourSchema = z.number().int().min(0).max(23);

/** 試合の日付（JST, YYYY-MM-DD）。存在しない日付は拒否する */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD の形式で入力してください")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "存在しない日付です");

/** Discord の ID（snowflake） */
export const snowflakeSchema = z.string().regex(/^\d{15,25}$/, "Discord の ID の形式ではありません");

export const slotInputSchema = z.object({ hour: hourSchema });

/** チームは、Discord のロールだけで決まる（表示名は、ロールの名前を使う） */
export const teamInputSchema = z.object({
  roleId: snowflakeSchema,
});

/** 点数の上限（勝利の点数・固定点）。桁あふれと、入力ミスを防ぐ。Discord のコマンドの max_value と同じ値 */
export const MAX_POINTS = 100_000;

export const settingsInputSchema = z.object({
  channelId: snowflakeSchema.nullable(),
  recruitHour: hourSchema,
  cutoffMinutes: z.number().int().min(1).max(180),
  fixedAfterMatches: z.number().int().min(0).max(100),
  fixedPoints: z.number().int().min(0).max(MAX_POINTS),
  revokeSessionsOnReissue: z.boolean(),
});

/** 管理者による、代理の挙手 */
export const adminHandupInputSchema = z.object({
  teamId: z.number().int().positive(),
  slotHour: hourSchema,
  /** 省略すると今日 */
  slotDate: dateSchema.optional(),
});

/** 日付の絞り込み（クエリ文字列）。省略すると今日 */
export const dateQuerySchema = z.object({ date: dateSchema.optional() });

/** 管理者による、組分けの追加（挙手は、自動で付く）。2チームは、別のチーム */
export const matchInputSchema = z
  .object({
    teamAId: z.number().int().positive(),
    teamBId: z.number().int().positive(),
    slotHour: hourSchema,
    /** 省略すると今日 */
    slotDate: dateSchema.optional(),
  })
  .refine((value) => value.teamAId !== value.teamBId, { message: "別のチームを選んでください", path: ["teamBId"] });

/** 対戦枠（日付 × 試合時刻）の指定。マッチングの確定と、やり直しに使う */
export const matchSlotInputSchema = z.object({
  slotHour: hourSchema,
  /** 省略すると今日 */
  slotDate: dateSchema.optional(),
});

/** 対戦枠のやり直し。notify（省略は true）が true なら、Discord に、マッチングのキャンセルを投稿する */
export const matchSlotReopenInputSchema = matchSlotInputSchema.extend({ notify: z.boolean().optional() });

/**
 * 組分けへの、勝利の記録（multipart/form-data）。フォームの値はすべて文字列で届くので、数値に変換する。
 * どの組分けかは、URL で決まる。画像（image）は、ファイルなのでこのスキーマには含めない。
 */
export const matchWinFormSchema = z.object({
  /** 勝ったチーム。その組分けの、2チームのどちらか */
  teamId: z.coerce.number().int().positive(),
  points: z.coerce.number().int().min(0).max(MAX_POINTS),
});

/** 勝利の記録を、有効にする / 無効にする */
export const winActiveInputSchema = z.object({ active: z.boolean() });

/** 勝利の記録の、点数（生の点数）の修正 */
export const winPointsInputSchema = z.object({ points: z.number().int().min(0).max(MAX_POINTS) });

/** ログインリンクのトークン（フラグメントで渡される） */
export const loginInputSchema = z.object({
  token: z.string().min(16).max(256),
});

export type SlotInput = z.infer<typeof slotInputSchema>;
export type TeamInput = z.infer<typeof teamInputSchema>;
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type MatchSlotInput = z.infer<typeof matchSlotInputSchema>;
export type MatchSlotReopenInput = z.infer<typeof matchSlotReopenInputSchema>;
export type MatchInput = z.infer<typeof matchInputSchema>;
export type AdminHandupInput = z.infer<typeof adminHandupInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
