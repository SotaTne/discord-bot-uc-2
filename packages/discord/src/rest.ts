import { RouteBases, Routes } from "discord-api-types/v10";
import type { ActionRow } from "./responses";

/** Discord の API の URL（バージョンつき）。公式の型定義の値を使う */
export const DISCORD_API_BASE = `${RouteBases.api}`;

export type MessagePayload = {
  content?: string;
  /**
   * 指定しないと、本文中のメンションが通知される。通知したくないときは { parse: [] } を渡す。
   * parse に "roles" を入れると、本文中のロールのメンションが、すべて通知される。roles に ID を渡すと、そのロールだけが通知される（どちらか一方）。
   * @here・@everyone は、parse に "everyone" を入れたときだけ通知される
   */
  allowed_mentions?: { parse?: string[]; roles?: string[] };
  flags?: number;
  /** ボタン。空の配列を渡すと、メッセージのボタンが消える（編集のとき） */
  components?: ActionRow[];
};

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`Discord API エラー ${status}: ${path}`);
    this.name = "DiscordApiError";
  }
}

export type DiscordRole = { id: string; name: string; position: number };

/** サーバーのメンバー（取得に使うフィールドだけ） */
export type DiscordMember = {
  /** サーバーでのニックネーム */
  nick?: string | null;
  user: { id: string; username: string; global_name?: string | null };
};

/** Discord での表示名。サーバーのニックネーム → アカウントの表示名 → ユーザー名の順 */
export const memberDisplayName = (member: DiscordMember): string =>
  member.nick || member.user.global_name || member.user.username;

export type DiscordRestOptions = {
  /** Bot のトークン */
  token: string;
  /** 開発時はモックの URL に差し替える（DISCORD_API_BASE） */
  baseUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
};

/** 必要な Discord REST の呼び出しだけをまとめた、薄いクライアント */
export function createDiscordRest(options: DiscordRestOptions) {
  const baseUrl = (options.baseUrl ?? DISCORD_API_BASE).replace(/\/$/, "");
  // グローバルの fetch は、this が違うと Workers で Illegal invocation になるので、関数で包んで呼ぶ
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = `Bot ${options.token}`;

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await doFetch(`${baseUrl}${path}`, init);
    if (!response.ok) {
      throw new DiscordApiError(response.status, await response.text(), path);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    /** チャンネルにメッセージを投稿する */
    createMessage: (channelId: string, payload: MessagePayload) =>
      request<{ id: string }>("POST", Routes.channelMessages(channelId), payload),

    /** deferred で返したインタラクションの応答を、あとから編集する（トークンで認証するので Bot トークンは不要） */
    editOriginalResponse: (applicationId: string, interactionToken: string, payload: MessagePayload) =>
      request<unknown>("PATCH", `${Routes.webhook(applicationId, interactionToken)}/messages/@original`, payload, false),

    /** チャンネルのメッセージを編集する（ボタンを消す・付け替える） */
    editMessage: (channelId: string, messageId: string, payload: MessagePayload) =>
      request<unknown>("PATCH", `${Routes.channelMessages(channelId)}/${messageId}`, payload),

    getGuildRoles: (guildId: string) => request<DiscordRole[]>("GET", Routes.guildRoles(guildId)),

    /** サーバーのメンバー1人（表示名を取るため。サーバーにいない人は 404） */
    getGuildMember: (guildId: string, userId: string) =>
      request<DiscordMember>("GET", Routes.guildMember(guildId, userId)),

    /**
     * スラッシュコマンドを登録する（渡したものに置き換わる。渡さなかった古いコマンドは消える）。
     * guildId を指定すると、そのサーバーだけに登録する（すぐに反映される）。省略すると、全サーバー（反映に時間がかかる）。
     */
    registerCommands: (applicationId: string, definitions: readonly unknown[], guildId?: string) =>
      request<{ name: string }[]>(
        "PUT",
        guildId ? Routes.applicationGuildCommands(applicationId, guildId) : Routes.applicationCommands(applicationId),
        definitions,
      ),
  };
}

export type DiscordRest = ReturnType<typeof createDiscordRest>;
