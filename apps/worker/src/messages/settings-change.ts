import { NO_MENTION, type RecruitMention } from "./recruit";

/** 設定を変えたときに、チャンネルに知らせる、変更の内容 */
export type SettingsChange = {
  /** 募集開始の時刻の変更。started: 新しい時刻が、すでに来ている（募集は、もう始まっている。いまから、挙手できる） */
  recruit?: { from: number; to: number; started: boolean };
  /** 締切（試合の何分前か）の変更 */
  cutoff?: { from: number; to: number };
};

/** 設定の変更の知らせ。通知先は、募集開始の投稿と同じ。先頭の行に、メンションを出す */
export function settingsChangeMessage(change: SettingsChange, mention: RecruitMention = NO_MENTION): string {
  const sections: string[] = [];
  if (change.recruit) {
    const lines = ["## 募集開始の時刻が変わりました", `${change.recruit.from}:00 → ${change.recruit.to}:00`];
    if (change.recruit.started) lines.push("すでに募集は始まっています。いまから挙手できます");
    sections.push(lines.join("\n"));
  }
  if (change.cutoff) {
    sections.push(["## 締切が変わりました", `試合の ${change.cutoff.from} 分前 → ${change.cutoff.to} 分前`].join("\n"));
  }
  const body = sections.join("\n\n");
  return mention.text ? `${mention.text}\n${body}` : body;
}
