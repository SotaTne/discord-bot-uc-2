import type { MatchingResult } from "@uc/core";
import type { Team } from "@uc/db";

/** 募集開始の投稿 */
export const recruitMessage = (hour: number) => `# ${hour}:00になりましたので、本日の募集を開始します`;

/**
 * マッチング結果の投稿。チームは、ロールのメンションで表す（組まれたチームと除外されたチームに、通知される）。
 * （挙手が足りないときは、メンションなし）
 */
export function matchingMessage(input: {
  hour: number;
  result: MatchingResult;
  teamById: Map<string, Team>;
}): string {
  const { hour, result, teamById } = input;
  if (result.kind === "insufficient") {
    return `## 試合 (時間:${hour}時)\n試合に参加するチームが十分ではありません`;
  }

  const mention = (id: string) => {
    const team = teamById.get(id);
    return team ? `<@&${team.roleId}>` : id;
  };
  const lines = [`## 試合 (時間:${hour}時) の組み合わせ:`];
  for (const [a, b] of result.pairs) {
    lines.push(`- ${mention(a)} vs ${mention(b)}`);
  }
  if (result.excluded) {
    lines.push(`- ${mention(result.excluded)} は参加チーム数が奇数だったためマッチングしませんでした`);
  }
  return lines.join("\n");
}
