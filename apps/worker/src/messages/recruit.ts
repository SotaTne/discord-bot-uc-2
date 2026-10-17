import { HERE_TARGET } from "@uc/api";
import type { GuildSettingsValues, Team } from "@uc/db";

/** 募集開始の投稿で、通知する相手 */
export type RecruitMention = {
  /** 本文の先頭に出す、メンションの文字（空なら、メンションなし） */
  text: string;
  /** 通知するロール（Discord のロールの ID） */
  roleIds: string[];
  /** @here を通知するか */
  here: boolean;
};

export const NO_MENTION: RecruitMention = { text: "", roleIds: [], here: false };

/**
 * 設定から、募集開始の通知先を決める。
 * - none: 誰にも通知しない（既定）
 * - teams: 登録済みのチームのロール全部
 * - roles: 設定で選んだロールと、@here
 */
export function recruitMention(settings: Pick<GuildSettingsValues, "recruitMentionMode" | "recruitMentionTargets">, teams: readonly Pick<Team, "roleId">[]): RecruitMention {
  const roleIds =
    settings.recruitMentionMode === "teams"
      ? teams.map((team) => team.roleId)
      : settings.recruitMentionMode === "roles"
        ? settings.recruitMentionTargets.filter((target) => target !== HERE_TARGET)
        : [];
  const here = settings.recruitMentionMode === "roles" && settings.recruitMentionTargets.includes(HERE_TARGET);
  const unique = [...new Set(roleIds)];
  return { text: [...(here ? ["@here"] : []), ...unique.map((id) => `<@&${id}>`)].join(" "), roleIds: unique, here };
}

/** 募集開始の投稿。通知先があれば、先頭の行に、メンションを出す */
export const recruitMessage = (hour: number, mention: RecruitMention = NO_MENTION) => {
  const body = `# ${hour}:00になりましたので、本日の募集を開始します`;
  return mention.text ? `${mention.text}\n${body}` : body;
};
