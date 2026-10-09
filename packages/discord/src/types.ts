import { PermissionFlagsBits } from "discord-api-types/v10";

/**
 * Discord の定数（種類・フラグ・権限）は、公式の型定義（discord-api-types）のものを、そのまま使う。
 * 下の Interaction は、そのうち、このアプリが扱う部分だけを、型にしたもの（受け取った JSON から、読むものだけ）。
 */
export { ApplicationCommandOptionType, InteractionResponseType, InteractionType, MessageFlags } from "discord-api-types/v10";

export type CommandOptionValue = {
  name: string;
  type: number;
  value?: string | number | boolean;
  focused?: boolean;
};

export type Interaction = {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: {
    user: { id: string; username: string };
    roles: string[];
    /** 実行者の権限（ビットフィールドを文字列で表したもの） */
    permissions: string;
  };
  data?: {
    name: string;
    options?: CommandOptionValue[];
    /** ロールや添付ファイルなど、オプションの ID が指す実体 */
    resolved?: {
      attachments?: Record<string, { id: string; url: string; filename: string; content_type?: string; size: number }>;
    };
    /** ボタンなどのコンポーネントが押されたときの ID */
    custom_id?: string;
  };
};

/** Administrator 権限のビット */
const ADMINISTRATOR = PermissionFlagsBits.Administrator;

export function hasAdministrator(permissions: string | undefined): boolean {
  if (!permissions) return false;
  try {
    return (BigInt(permissions) & ADMINISTRATOR) !== 0n;
  } catch {
    return false;
  }
}
