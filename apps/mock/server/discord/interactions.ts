import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  MessageFlags,
  commands,
  type CommandOptionValue,
  type Interaction,
  type InteractionResponse,
} from "@uc/discord";
import { signRequest, type DevKeyPair } from "@uc/discord/testing";
import type { MockState } from "./state";

export type InteractionClientOptions = {
  /** worker の URL（例: http://localhost:5173） */
  workerUrl: string;
  /** この疑似 Discord の URL。添付ファイルの URL に使う（worker が取りに来る） */
  mockUrl: string;
  keys: DevKeyPair;
  applicationId: string;
  fetch?: typeof fetch;
  /** 署名のタイムスタンプ用。テストで固定できるようにしてある */
  nowSeconds?: () => number;
};

export type SendCommandInput = {
  userId: string;
  name: string;
  /** コマンドのオプション。ロールは名前か ID で、添付ファイルは state.addAttachment の ID で指定する */
  options?: Record<string, string | number>;
};

export type SendResult = {
  /** worker が返した HTTP ステータス */
  status: number;
  response: InteractionResponse | undefined;
};

/**
 * Discord のサーバー役の、worker に向けた側。
 * 本物の Discord と同じ形式・同じ署名で、worker の /interactions に、コマンドやボタンの操作を送る。
 * （worker の開発用ルート /dev/* を呼ぶのは、Discord の役ではないので、api/worker-dev.ts にある）
 */
export function createDiscordInteractions(options: InteractionClientOptions, state: MockState) {
  const doFetch = options.fetch ?? fetch;
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const workerUrl = options.workerUrl.replace(/\/$/, "");
  const mockUrl = options.mockUrl.replace(/\/$/, "");

  /** 署名して、/interactions に送る（時計は、worker が持つ。ここでは、伝えない） */
  async function post(interaction: Interaction): Promise<SendResult> {
    const body = JSON.stringify(interaction);
    const timestamp = String(nowSeconds());
    const signature = await signRequest({ privateKey: options.keys.privateKey, timestamp, body });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Signature-Ed25519": signature,
      "X-Signature-Timestamp": timestamp,
    };

    const httpResponse = await doFetch(`${workerUrl}/interactions`, { method: "POST", headers, body });
    if (!httpResponse.ok) return { status: httpResponse.status, response: undefined };
    return { status: httpResponse.status, response: (await httpResponse.json()) as InteractionResponse };
  }

  function baseInteraction(userId: string): Interaction {
    const user = state.userById(userId);
    if (!user) throw new Error(`ユーザーが見つかりません: ${userId}`);
    return {
      id: state.newId(),
      application_id: options.applicationId,
      type: 2,
      token: `mock-${state.newId()}`,
      guild_id: state.guildId,
      channel_id: state.channelId,
      member: {
        user: { id: user.id, username: user.username },
        roles: user.roleIds,
        permissions: user.isAdmin ? "8" : "0",
      },
    };
  }

  const isEphemeral = (response: InteractionResponse) =>
    ((response.data?.flags ?? 0) & MessageFlags.Ephemeral) !== 0;

  async function sendCommand(input: SendCommandInput): Promise<SendResult> {
    const definition = commands.find((command) => command.name === input.name);
    if (!definition) throw new Error(`コマンドが見つかりません: ${input.name}`);

    const interaction = baseInteraction(input.userId);
    const built = buildOptions(definition.options ?? [], input.options ?? {}, state, mockUrl);
    interaction.data = {
      name: input.name,
      options: built.options,
      ...(Object.keys(built.attachments).length > 0 ? { resolved: { attachments: built.attachments } } : {}),
    };

    // 応答（考え中）を受け取る前に、worker が返信を編集しに来ることがある。先に、受け付けられるようにしておく。
    // deferred の返信は ephemeral なので、既定では本人にだけ見えるものとして扱う（応答の内容で、あとから確かめる）
    state.markPending(interaction.token, { userId: input.userId, channelId: state.channelId, ephemeral: true });

    const result = await post(interaction);
    const { response } = result;
    if (!response) return result;

    if (response.type === InteractionResponseType.ChannelMessageWithSource) {
      state.addMessage({
        channelId: state.channelId,
        content: response.data?.content ?? "",
        visibleTo: isEphemeral(response) ? input.userId : null,
        components: response.data?.components,
      });
    } else if (response.type === InteractionResponseType.DeferredChannelMessageWithSource) {
      state.markPending(interaction.token, {
        userId: input.userId,
        channelId: state.channelId,
        ephemeral: isEphemeral(response),
      });
    }
    return result;
  }

  /** メッセージのボタンを押す。押されたメッセージは、応答の内容で置き換わる */
  async function sendComponent(input: { userId: string; customId: string; messageId: string }): Promise<SendResult> {
    const interaction = baseInteraction(input.userId);
    interaction.type = 3;
    interaction.data = { name: "", custom_id: input.customId };

    const result = await post(interaction);
    const { response } = result;
    if (!response) return result;

    if (response.type === InteractionResponseType.UpdateMessage) {
      state.replaceMessage(input.messageId, {
        content: response.data?.content ?? "",
        components: response.data?.components,
      });
    } else if (response.type === InteractionResponseType.ChannelMessageWithSource) {
      state.addMessage({
        channelId: state.channelId,
        content: response.data?.content ?? "",
        visibleTo: isEphemeral(response) ? input.userId : null,
      });
    }
    return result;
  }

  return { sendCommand, sendComponent };
}

type OptionDefinition = { name: string; type: number; required?: boolean };

function buildOptions(
  definitions: OptionDefinition[],
  given: Record<string, string | number>,
  state: MockState,
  mockUrl: string,
) {
  for (const key of Object.keys(given)) {
    if (!definitions.some((definition) => definition.name === key)) {
      throw new Error(`このコマンドにないオプションです: ${key}`);
    }
  }

  const result: CommandOptionValue[] = [];
  const attachments: Record<string, { id: string; url: string; filename: string; content_type: string; size: number }> = {};

  for (const definition of definitions) {
    const raw = given[definition.name];
    if (raw === undefined || raw === "") {
      if (definition.required) throw new Error(`必須のオプションがありません: ${definition.name}`);
      continue;
    }

    switch (definition.type) {
      case ApplicationCommandOptionType.Integer: {
        const value = Number(raw);
        if (!Number.isInteger(value)) throw new Error(`整数で指定してください: ${definition.name}`);
        result.push({ name: definition.name, type: definition.type, value });
        break;
      }
      case ApplicationCommandOptionType.Role: {
        const role = state.findRole(String(raw));
        if (!role) throw new Error(`ロールが見つかりません: ${String(raw)}`);
        result.push({ name: definition.name, type: definition.type, value: role.id });
        break;
      }
      case ApplicationCommandOptionType.Attachment: {
        const attachment = state.getAttachment(String(raw));
        if (!attachment) throw new Error(`添付ファイルが見つかりません: ${definition.name}`);
        attachments[attachment.id] = {
          id: attachment.id,
          url: `${mockUrl}/attachments/${attachment.id}`,
          filename: attachment.filename,
          content_type: attachment.contentType,
          size: attachment.bytes.byteLength,
        };
        result.push({ name: definition.name, type: definition.type, value: attachment.id });
        break;
      }
      default:
        result.push({ name: definition.name, type: definition.type, value: String(raw) });
    }
  }
  return { options: result, attachments };
}
