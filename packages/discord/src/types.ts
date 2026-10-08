/** Interactions のうち、このアプリが扱う部分だけを型にしたもの */

export const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  ApplicationCommandAutocomplete: 4,
  ModalSubmit: 5,
} as const;

export const InteractionResponseType = {
  Pong: 1,
  ChannelMessageWithSource: 4,
  DeferredChannelMessageWithSource: 5,
  DeferredUpdateMessage: 6,
  UpdateMessage: 7,
  ApplicationCommandAutocompleteResult: 8,
} as const;

export const MessageFlags = {
  SuppressEmbeds: 1 << 2,
  Ephemeral: 1 << 6,
} as const;

export const ApplicationCommandOptionType = {
  String: 3,
  Integer: 4,
  Role: 8,
  Attachment: 11,
} as const;

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
const ADMINISTRATOR = 1n << 3n;

export function hasAdministrator(permissions: string | undefined): boolean {
  if (!permissions) return false;
  try {
    return (BigInt(permissions) & ADMINISTRATOR) !== 0n;
  } catch {
    return false;
  }
}
