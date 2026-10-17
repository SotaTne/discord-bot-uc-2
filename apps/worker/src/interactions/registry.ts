import type { Clock } from "@uc/core";
import type { Db } from "@uc/db";
import type { DiscordRest, Interaction, InteractionResponse } from "@uc/discord";
import type { AppEnv } from "../env";
import { adminDashboard } from "./admin-dashboard";
import { adminStatus } from "./admin-status";
import { handdown } from "./handdown";
import { handup } from "./handup";
import { status } from "./status";
import { teams } from "./teams";
import { join, wait, waitCancel } from "./waiting";

export type CommandContext = {
  interaction: Interaction;
  env: AppEnv;
  clock: Clock;
  /** 疑似時計の影響を受けない時計。ログインリンクの有効期限など、認証に関わる時刻に使う */
  db: Db;
  rest: DiscordRest;
  /** 外部（添付ファイルの取得など）への通信。テストで差し替える */
  fetch: typeof fetch;
  /** この worker の URL（オリジン）。ダッシュボードのリンクに使う */
  origin: string;
  /** 待つ（返信の編集のやり直しなどに使う）。テストでは待たずに進める */
  sleep: (ms: number) => Promise<void>;
  /** 応答を返した後も続けたい処理（deferred の後始末など）を登録する */
  waitUntil: (promise: Promise<unknown>) => void;
};

export type CommandHandler = (context: CommandContext) => Promise<InteractionResponse>;

/** コマンド名から処理への対応。コマンドを実装するたびに、ここへ登録する */
export const commandHandlers: Record<string, CommandHandler> = {
  "uc-handup": handup,
  "uc-handdown": handdown,
  "uc-status": status,
  "uc-teams": teams,
  "uc-admin-status": adminStatus,
  "uc-admin-dashboard": adminDashboard,
};

/** ボタンなどのコンポーネントの処理。custom_id の「:」より前の部分が、キーになる */
export const componentHandlers: Record<string, CommandHandler> = {
  wait,
  "wait-cancel": waitCancel,
  join,
};
