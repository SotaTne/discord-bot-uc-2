import type { MatchingResult } from "@uc/core";
import type { Team } from "@uc/db";

/**
 * マッチングのキャンセルの投稿（対戦枠のやり直し）。取り消された組分けと、組まれなかったチームを、マッチング結果と同じ並びで出す。
 * チームは、ロールのメンションで表す（取り消された組分けのチームに、通知される）。
 */
export function matchingCancelledMessage(input: {
  hour: number;
  pairs: [teamAId: number, teamBId: number][];
  excluded: number | null;
  teamById: Map<number, Team>;
}): string {
  const mention = (id: number) => {
    const team = input.teamById.get(id);
    return team ? `<@&${team.roleId}>` : String(id);
  };
  const lines = [`## ${input.hour}時のマッチングはキャンセルされました`];
  for (const [a, b] of input.pairs) lines.push(`- ${mention(a)} vs ${mention(b)}`);
  if (input.excluded) lines.push(`- ${mention(input.excluded)}（マッチングしていませんでした）`);
  return lines.join("\n");
}

/**
 * マッチング結果の投稿。チームは、ロールのメンションで表す（組まれたチームと除外されたチームに、通知される）。
 * 見出しに、その日の何試合目か（`number`）を出す。組分けごとに、主催（部屋を立てる側）を添える。主催は、組分けを作るときに、無作為に決めて保存したもの（`hostOf` で渡す）。
 * （挙手が足りないときは、メンションなし）
 */
export function matchingMessage(input: {
  /** その日の何試合目か（1 から。その日の対戦枠を、時刻順に並べた順番） */
  number: number;
  hour: number;
  /** 組分けの主催（2 チームのうちの 1 チームの ID）を返す */
  hostOf: (teamAId: number, teamBId: number) => number;
  result: MatchingResult;
  teamById: Map<number, Team>;
}): string {
  const { number, hour, hostOf, result, teamById } = input;
  if (result.kind === "insufficient") {
    return `## 第${number}試合 (時間:${hour}時)\n試合に参加するチームが十分ではありません`;
  }

  const mention = (id: number) => {
    const team = teamById.get(id);
    return team ? `<@&${team.roleId}>` : String(id);
  };
  const lines = [`## 第${number}試合 (時間:${hour}時) の組分け:`];
  for (const [a, b] of result.pairs) {
    lines.push(`- ${mention(a)} vs ${mention(b)}（主催: ${mention(hostOf(a, b))}）`);
  }
  if (result.excluded) {
    lines.push(`- ${mention(result.excluded)} は参加チーム数が奇数だったためマッチングしませんでした`);
  }
  return lines.join("\n");
}
