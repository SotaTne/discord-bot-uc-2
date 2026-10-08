import { ApplicationCommandOptionType as OptionType } from "./types";

type CommandOption = {
  name: string;
  description: string;
  type: number;
  required?: boolean;
  min_value?: number;
  max_value?: number;
};

export type CommandDefinition = {
  name: string;
  description: string;
  options?: CommandOption[];
  /** "8" は Administrator。画面上で一般ユーザーに見せないための設定（実行時にも必ず権限を確認する） */
  default_member_permissions?: string;
  /** DM では使えない */
  dm_permission: false;
};

const ADMIN_ONLY = "8";

const timeOption: CommandOption = {
  name: "time",
  description: "試合の開始時刻（時）",
  type: OptionType.Integer,
  required: true,
  min_value: 0,
  max_value: 23,
};

const teamRoleOption = (required: boolean, description: string): CommandOption => ({
  name: "team-role",
  description,
  type: OptionType.Role,
  required,
});

/** Discord に登録するコマンド。仕様は SPEC.md の「Discord コマンド」を参照 */
export const commands: CommandDefinition[] = [
  {
    name: "uc-handup",
    description: "挙手する（自チームがその時刻の試合に出る）",
    options: [timeOption],
    dm_permission: false,
  },
  {
    name: "uc-handdown",
    description: "挙手を取り消す",
    options: [timeOption],
    dm_permission: false,
  },
  {
    name: "uc-status",
    description: "自チームの挙手状況を見る",
    dm_permission: false,
  },
  {
    name: "uc-teams",
    description: "チームごとの得点を見る",
    dm_permission: false,
  },
  {
    name: "uc-admin-status",
    description: "(管理者のみ) 今日の、すべてのチームの挙手状況とマッチング結果を見る",
    default_member_permissions: ADMIN_ONLY,
    dm_permission: false,
  },
  {
    name: "uc-admin-win",
    description: "(管理者のみ) 勝利を追加する",
    // 必須のオプションは、任意のオプションより前に並べる（Discord の決まり）
    options: [
      timeOption,
      teamRoleOption(true, "勝ったチームのロール"),
      {
        name: "point",
        description: "点数",
        type: OptionType.Integer,
        required: true,
        min_value: 0,
        // @uc/api の MAX_POINTS と同じ値（worker のテストで、そろっていることを確かめる）
        max_value: 100000,
      },
      {
        name: "image",
        description: "結果の画像",
        type: OptionType.Attachment,
        required: true,
      },
      {
        name: "date",
        description: "試合の日付（YYYY-MM-DD）。省略すると直近のその時刻の試合",
        type: OptionType.String,
        required: false,
      },
    ],
    default_member_permissions: ADMIN_ONLY,
    dm_permission: false,
  },
  {
    name: "uc-admin-score-clear",
    description: "(管理者のみ) すべてのチームの得点をクリアする",
    default_member_permissions: ADMIN_ONLY,
    dm_permission: false,
  },
  {
    name: "uc-admin-dashboard",
    description: "(管理者のみ) ダッシュボードへのリンクを発行する",
    default_member_permissions: ADMIN_ONLY,
    dm_permission: false,
  },
];
