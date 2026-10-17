import { hasAdministrator, type Interaction } from "@uc/discord";

export const ADMIN_ONLY_MESSAGE = "管理者権限を持たないユーザーはこのコマンドを使えません";

/** 実行した人が Administrator 権限を持っているか（実行のたびに必ず確認する） */
export const isAdmin = (interaction: Interaction) => hasAdministrator(interaction.member?.permissions);
