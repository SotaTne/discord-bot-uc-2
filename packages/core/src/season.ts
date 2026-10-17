/**
 * 大会の期間（JST の日付。YYYY-MM-DD）。開始日と終了日は、どちらも含む。
 * 両方 null は、期間を設けない（いつも開催中）。片方だけ null は、壊れた設定として扱う。
 */
export type SeasonWindow = {
  start: string | null;
  end: string | null;
};

/**
 * その日に対して、何ができるか。
 * - play: 挙手・募集・マッチングなど、通常の操作
 * - repair: 大会が終わったあと。期間に入っていた日の、組分けの削除と、やり直しだけ
 * - closed: 操作しない（見るだけ）
 */
export type SeasonAccess = "play" | "repair" | "closed";

/**
 * 今日（today）から見て、対象の試合日（date）を操作できるか。
 * 日付は YYYY-MM-DD なので、文字列の比較が、日付の順になる。
 * 「今日が開催日か」は、seasonAccess(today, today) が play かで決める。
 * 開始前に、期間内の未来の日を seasonAccess(未来, 未来) で見ると play になるので、それを開催日の判定に使わない。
 */
export function seasonAccess(today: string, date: string, season: SeasonWindow): SeasonAccess {
  const { start, end } = season;
  if (start === null && end === null) return "play";
  if (start === null || end === null) return "closed";
  if (date < start || date > end) return "closed";
  if (today < start) return "closed";
  if (today > end) return "repair";
  return "play";
}

/**
 * その日が、大会の期間に入っているか。期間が空なら、入っている。
 * 今日が期間の前か後かは、見ない。待機のメッセージを閉じる対象の判定に使う
 * （期間内の日は、試合開始の時刻を過ぎていれば、大会が終わったあとでも閉じる）。
 */
export function dateInSeason(date: string, season: SeasonWindow): boolean {
  const { start, end } = season;
  if (start === null && end === null) return true;
  if (start === null || end === null) return false;
  return start <= date && date <= end;
}

/** 期間外であることの文面。開始と終了が両方あれば、その範囲を添える */
export function seasonClosedMessage(season: SeasonWindow): string {
  if (season.start !== null && season.end !== null) {
    return `いまは大会の期間外です（${season.start}〜${season.end}）`;
  }
  return "いまは大会の期間外です";
}
