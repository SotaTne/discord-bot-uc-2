/** Worker に渡されるバインディングと環境変数 */
export type AppEnv = {
  DB: D1Database;
  /** Discord アプリの公開鍵（Interactions の署名検証に使う） */
  DISCORD_PUBLIC_KEY: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  /** 開発時だけ、モックの Discord REST の URL に差し替える（本番では、設定しない） */
  DISCORD_API_BASE?: string;
  /** ダッシュボードの URL（ログインリンクの先）。省略すると、リクエストを受けた URL を使う */
  PUBLIC_URL?: string;
};
