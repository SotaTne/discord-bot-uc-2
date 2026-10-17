import { InteractionResponseType, MessageFlags } from "./types";

export type ButtonComponent = {
  type: 2;
  /** 1: primary, 2: secondary, 3: success, 4: danger */
  style: 1 | 2 | 3 | 4;
  label: string;
  custom_id: string;
};

export type ActionRow = { type: 1; components: ButtonComponent[] };

export type InteractionResponse = {
  type: number;
  data?: {
    content?: string;
    flags?: number;
    allowed_mentions?: { parse: string[] };
    components?: ActionRow[];
  };
};

export const pong = (): InteractionResponse => ({ type: InteractionResponseType.Pong });

/**
 * 本人にだけ見える返信。メンションは表示されるだけで通知しない。
 * suppressEmbeds を指定すると、本文中の URL のプレビュー（埋め込み）を出さない。
 */
export const ephemeralMessage = (
  content: string,
  options: { suppressEmbeds?: boolean } = {},
): InteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: {
    content,
    flags: MessageFlags.Ephemeral | (options.suppressEmbeds ? MessageFlags.SuppressEmbeds : 0),
    allowed_mentions: { parse: [] },
  },
});

/** 「実行する / キャンセル」の確認ボタンつきの、本人にだけ見える返信 */
export const confirmMessage = (input: {
  content: string;
  confirmId: string;
  confirmLabel: string;
  cancelId: string;
}): InteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: {
    content: input.content,
    flags: MessageFlags.Ephemeral,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 4, label: input.confirmLabel, custom_id: input.confirmId },
          { type: 2, style: 2, label: "キャンセル", custom_id: input.cancelId },
        ],
      },
    ],
  },
});

/**
 * ボタンが押されたメッセージを、新しい本文に置き換える。components を渡さなければ、ボタンは消える。
 * 編集では、メンションは通知されない（通知したいときは、新しいメッセージを投稿する）。
 */
export const updateMessage = (content: string, components: ActionRow[] = []): InteractionResponse => ({
  type: InteractionResponseType.UpdateMessage,
  data: { content, components, allowed_mentions: { parse: [] } },
});

/** 3秒以内に応答できない処理のために、まず「考え中」を返す（あとで編集する） */
export const deferEphemeral = (): InteractionResponse => ({
  type: InteractionResponseType.DeferredChannelMessageWithSource,
  data: { flags: MessageFlags.Ephemeral },
});
