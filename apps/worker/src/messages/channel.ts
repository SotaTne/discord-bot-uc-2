import type { MatchingResult } from "@uc/core";
import type { Team } from "@uc/db";
import type { DiscordRest } from "@uc/discord";
import { matchingCancelledMessage, matchingMessage } from "./matching";
import { NO_MENTION, recruitMessage, type RecruitMention } from "./recruit";
import { settingsChangeMessage, type SettingsChange } from "./settings-change";

/**
 * 投稿先のチャンネルに、投稿する（Worker が、チャンネルへ投稿するのは、ここだけ）。
 * 誰に通知が飛ぶか（allowed_mentions）も、ここで決める。文面は、同じフォルダの、recruit.ts・matching.ts。
 */
export type ChannelPoster = Pick<DiscordRest, "createMessage">;

const teamsById = (teams: readonly Team[]) => new Map(teams.map((team) => [team.id, team]));

/** 募集開始。設定した通知先（ロール・@here）にだけ、通知する（既定は、誰にも通知しない） */
export async function postRecruit(
  rest: ChannelPoster,
  input: { channelId: string; hour: number; mention?: RecruitMention },
): Promise<void> {
  const mention = input.mention ?? NO_MENTION;
  await rest.createMessage(input.channelId, {
    content: recruitMessage(input.hour, mention),
    // 通知する相手を、ここで、はっきり決める（本文に、ほかのメンションが紛れても、通知されない）
    allowed_mentions: { parse: mention.here ? ["everyone"] : [], roles: mention.roleIds },
  });
}

/** マッチング結果。組まれたチームと、組まれなかったチームのロールに、通知する */
export async function postMatchingResult(
  rest: ChannelPoster,
  input: {
    channelId: string;
    hour: number;
    /** そのチームの、その組分けは、何試合目か */
    numberOf: (teamId: number, teamAId: number, teamBId: number) => number | undefined;
    result: MatchingResult;
    /** 組分けの主催（2 チームのうちの 1 チームの ID）を返す */
    hostOf: (teamAId: number, teamBId: number) => number;
    teams: readonly Team[];
  },
): Promise<void> {
  await rest.createMessage(input.channelId, {
    content: matchingMessage({ hour: input.hour, numberOf: input.numberOf, hostOf: input.hostOf, result: input.result, teamById: teamsById(input.teams) }),
    allowed_mentions: { parse: ["roles"] },
  });
}

/** マッチングのキャンセル（対戦枠のやり直し）。取り消された組分けのチームのロールに、通知する */
export async function postMatchingCancelled(
  rest: ChannelPoster,
  input: { channelId: string; hour: number; pairs: [teamAId: number, teamBId: number][]; excluded: number | null; teams: readonly Team[] },
): Promise<void> {
  await rest.createMessage(input.channelId, {
    content: matchingCancelledMessage({ hour: input.hour, pairs: input.pairs, excluded: input.excluded, teamById: teamsById(input.teams) }),
    allowed_mentions: { parse: ["roles"] },
  });
}

/** 設定の変更（募集開始の時刻・締切）の知らせ。通知先は、募集開始の投稿と、同じ */
export async function postSettingsChange(
  rest: ChannelPoster,
  input: { channelId: string; change: SettingsChange; mention?: RecruitMention },
): Promise<void> {
  const mention = input.mention ?? NO_MENTION;
  await rest.createMessage(input.channelId, {
    content: settingsChangeMessage(input.change, mention),
    allowed_mentions: { parse: mention.here ? ["everyone"] : [], roles: mention.roleIds },
  });
}
