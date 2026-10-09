/**
 * 送られてきた合言葉が、本物と同じか。合言葉が未設定（null・空）なら、何を送られても、false。
 * どこまで合っているかが、時間に出ないように、全部の文字を比べる（Apps Script には、crypto がないので、自分で比べる）
 */
export function isAuthorizedKey(given: string | undefined | null, expected: string | undefined | null): boolean {
  if (!expected || !given) return false;
  let difference = given.length ^ expected.length;
  const length = Math.max(given.length, expected.length);
  for (let index = 0; index < length; index++) {
    difference |= (given.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}
