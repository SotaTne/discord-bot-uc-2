import type { ActionRow } from "@uc/discord";

/**
 * ロール登録のメッセージ（チームのロールを選ぶボタン）と、ボタンの custom_id。
 * 永続のメッセージ: 専用のチャンネルに置き、チームを登録・削除するたびに、ボタンを作り直す。
 * チームは 20 ごとにメッセージを分ける（Discord は、1 メッセージに 5 行まで。操作のボタンの行を残すため）。
 * ボタンは、全員に同じ見た目で出る（Discord は、人ごとに変えられない）。人ごとの結果は、本人にだけ見える返信で返す。
 */

/** 「チームのボタン」の custom_id。「role-set:チームの ID」 */
export const roleSetId = (teamId: number) => `role-set:${teamId}`;
export const ROLE_REMOVE_ID = "role-remove";
export const ROLE_CHECK_ID = "role-check";

/** custom_id から、チームの ID を取り出す。形が違えば null */
export function parseRoleSetId(customId: string): number | null {
  const [action, id] = customId.split(":");
  if (action !== "role-set" || !id || !/^\d+$/.test(id)) return null;
  return Number(id);
}

/** チームのボタンは、1 行に 5 つ。操作のボタンの行を除いて、4 行まで（Discord は、メッセージに 5 行まで） */
export const MAX_ROLE_TEAM_BUTTONS = 20;

const LABEL_MAX = 80;
const clip = (text: string) => (text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text);

const ACTIONS: ActionRow = {
  type: 1,
  components: [
    { type: 2, style: 4, label: "今のロールを外す", custom_id: ROLE_REMOVE_ID },
    { type: 2, style: 2, label: "ロールを確認", custom_id: ROLE_CHECK_ID },
  ],
};

/** チームを 20 ごとに分ける。0 チームでも、操作のボタンを置くメッセージを 1 つ出す */
function pagesOf<T>(teams: readonly T[]): T[][] {
  if (teams.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < teams.length; i += MAX_ROLE_TEAM_BUTTONS) pages.push(teams.slice(i, i + MAX_ROLE_TEAM_BUTTONS));
  return pages;
}

/**
 * ロール登録のメッセージ。チームが 21 以上のときは、20 チームごとに 1 つ（各メッセージに、「今のロールを外す」「ロールを確認」）。
 */
export function roleRegistrationMessages(input: { teams: readonly { id: number; name: string }[] }): { content: string; components: ActionRow[] }[] {
  const pages = pagesOf(input.teams);
  return pages.map((teams, index) => {
    const lines = [
      pages.length > 1 ? `# チームのロールを選んでください（${index + 1}/${pages.length}）` : "# チームのロールを選んでください",
      "試合に出るには、チームのロールが必要です。自分のチームのボタンを押すと、ロールが付きます。",
      "- すでにチームのロールを持っているときは、ほかのチームのロールには変えられません。先に「今のロールを外す」を押してください",
      "- いまのロールは、「ロールを確認」で見られます（本人にだけ見えます）",
    ];
    if (input.teams.length === 0) lines.push("", "いまは、登録されているチームがありません。");
    if (pages.length > 1) lines.push("", `チームが多いため、${pages.length} つのメッセージに分けています。`);

    const rows: ActionRow[] = [];
    for (let i = 0; i < teams.length; i += 5) {
      rows.push({
        type: 1,
        components: teams.slice(i, i + 5).map((team) => ({ type: 2, style: 1, label: clip(team.name), custom_id: roleSetId(team.id) })),
      });
    }
    rows.push(ACTIONS);
    return { content: lines.join("\n"), components: rows };
  });
}
