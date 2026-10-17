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

export const slotHourInputSchema = z.object({ hour: hourSchema });

/** チームは、Discord のロールだけで決まる（表示名は、ロールの名前を使う） */
export const teamInputSchema = z.object({
  roleId: snowflakeSchema,
});

/** 募集開始の通知先の選び方。none: 誰にも / teams: 登録済みのチームのロール全部 / roles: 選んだもの */
export const RECRUIT_MENTION_MODES = ["none", "teams", "roles"] as const;

/** 通知先として選べる、特別な宛先（@here）。ロールの ID と同じ配列に入れる */
export const HERE_TARGET = "here";

/** 通知先（mode が roles のとき）: Discord のロールの ID か、"here"。重ならない */
const mentionTargetsSchema = z
  .array(z.union([snowflakeSchema, z.literal(HERE_TARGET)]))
  .max(25)
  .refine((targets) => new Set(targets).size === targets.length, { message: "同じ通知先が、重なっています" });

const settingsObjectSchema = z.object({
  channelId: snowflakeSchema.nullable(),
  /** ロール登録のメッセージを投稿するチャンネル。null（省略も）は、使わない */
  roleChannelId: snowflakeSchema.nullable().default(null),
  recruitHour: hourSchema,
  cutoffMinutes: z.number().int().min(1).max(180),
  recruitMentionMode: z.enum(RECRUIT_MENTION_MODES),
  recruitMentionTargets: mentionTargetsSchema,
  /** チームの試合数の規定数。null は、規定数なし（省略も、なし） */
  matchLimit: z.number().int().min(1).max(999).nullable().default(null),
  /** 大会の期間（JST の日付）。両方空（省略も）は、期間を設けない。片方だけでは、保存できない */
  seasonStart: dateSchema.nullable().default(null),
  seasonEnd: dateSchema.nullable().default(null),
  revokeSessionsOnReissue: z.boolean(),
});

/** 開始日と終了日は、両方入れるか、両方空。入れるときは、開始が終了より後にならない */
function withSeason<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const start = (value as { seasonStart: string | null }).seasonStart;
    const end = (value as { seasonEnd: string | null }).seasonEnd;
    if ((start === null) !== (end === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "開始日と終了日は、両方入れるか、両方空にしてください",
        path: ["seasonEnd"],
      });
    } else if (start !== null && end !== null && start > end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "開始日は、終了日と同じか、それより前にしてください",
        path: ["seasonEnd"],
      });
    }
  });
}

export const settingsInputSchema = withSeason(settingsObjectSchema);

/**
 * 設定の保存。notifyChange が true で、募集開始の時刻か締切が変わったときは、変更を、投稿先のチャンネルに知らせる
 * （通知先は、募集開始の投稿と同じ。省略は、知らせない）
 * 期間の規則は、入力と同じ（refine したスキーマは extend できないので、こちらでも付ける）
 */
export const settingsUpdateSchema = withSeason(settingsObjectSchema.extend({ notifyChange: z.boolean().optional() }));

/** 管理者による、代理の挙手 */
export const adminHandupInputSchema = z.object({
  teamId: z.number().int().positive(),
  slotHour: hourSchema,
  /** 省略すると今日 */
  slotDate: dateSchema.optional(),
});

/** 組分けの削除。notify は、クエリ文字列（"true" で、Discord に、組分けの変更を投稿する。条件は、追加と同じ） */
export const matchDeleteQuerySchema = z.object({ notify: z.enum(["true", "false"]).optional() });

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
    /** マッチング済みで、試合開始前の対戦枠で、Discord に、組分けの変更を投稿する（省略は、投稿しない。それ以外の対戦枠では、無視する） */
    notify: z.boolean().optional(),
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

/** ログインリンクのトークン（フラグメントで渡される） */
export const loginInputSchema = z.object({
  token: z.string().min(16).max(256),
});

export type SlotHourInput = z.infer<typeof slotHourInputSchema>;
export type TeamInput = z.infer<typeof teamInputSchema>;
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;
export type MatchSlotInput = z.infer<typeof matchSlotInputSchema>;
export type MatchSlotReopenInput = z.infer<typeof matchSlotReopenInputSchema>;
export type MatchInput = z.infer<typeof matchInputSchema>;
export type AdminHandupInput = z.infer<typeof adminHandupInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
