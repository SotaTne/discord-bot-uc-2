import type { MatchingResult } from "@uc/core";
import type { Team } from "@uc/db";
import type { DiscordRest } from "@uc/discord";
import { matchingCancelledMessage, matchingMessage } from "./matching";
import { recruitMessage } from "./recruit";

/**
 * 投稿先のチャンネルに、投稿する（Worker が、チャンネルへ投稿するのは、ここだけ）。
 * 誰に通知が飛ぶか（allowed_mentions）も、ここで決める。文面は、同じフォルダの、recruit.ts・matching.ts。
 */
export type ChannelPoster = Pick<DiscordRest, "createMessage">;

const teamsById = (teams: readonly Team[]) => new Map(teams.map((team) => [team.id, team]));

/** 募集開始。誰にも、通知しない */
export async function postRecruit(rest: ChannelPoster, input: { channelId: string; hour: number }): Promise<void> {
  await rest.createMessage(input.channelId, { content: recruitMessage(input.hour), allowed_mentions: { parse: [] } });
}

/** マッチング結果。組まれたチームと、組まれなかったチームのロールに、通知する */
export async function postMatchingResult(
  rest: ChannelPoster,
  input: { channelId: string; hour: number; result: MatchingResult; teams: readonly Team[] },
): Promise<void> {
  await rest.createMessage(input.channelId, {
    content: matchingMessage({ hour: input.hour, result: input.result, teamById: teamsById(input.teams) }),
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
