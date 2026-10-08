/**
 * 設定の入力欄の検証（保存する前に、その場で、理由を出すため）。範囲は、API の入力スキーマ（@uc/api の settingsInputSchema）と同じ。
 * 値は、入力欄の文字のまま受け取る。問題がなければ undefined、あれば、理由（画面に出す文言）を返す。
 */

const isInteger = (value: string) => /^\d+$/.test(value.trim());

const integerInRange = (value: string, min: number, max: number | null): string | undefined => {
  if (value.trim() === "") return "数字を入力してください";
  if (!isInteger(value)) return "0 以上の整数を入力してください";
  const number = Number(value);
  if (number < min) return `${min} 以上にしてください`;
  if (max !== null && number > max) return `${max} 以下にしてください`;
  return undefined;
};

/** 投稿先のチャンネル ID（空なら、投稿しない） */
export const validateChannelId = (value: string): string | undefined =>
  value.trim() === "" || /^\d{15,25}$/.test(value.trim()) ? undefined : "Discord のチャンネル ID（15〜25 桁の数字）を入力してください";

/** 募集開始時刻（時, 0〜23） */
export const validateRecruitHour = (value: string) => integerInRange(value, 0, 23);

/** 締切（試合の何分前, 1〜180） */
export const validateCutoffMinutes = (value: string) => integerInRange(value, 1, 180);

/** N（記録した点数で集計する試合数, 0〜100） */
export const validateFixedAfterMatches = (value: string) => integerInRange(value, 0, 100);

/** 固定点（0 以上） */
export const validateFixedPoints = (value: string) => integerInRange(value, 0, null);
