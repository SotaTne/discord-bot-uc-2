/** API が返したエラー。code は、worker が返す { error: "..." } の値 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`API エラー ${status}: ${code}`);
    this.name = "ApiError";
  }
}

type JsonResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type BodyOf<R> = R extends { json(): Promise<infer B> } ? B : never;

/**
 * API の応答から、成功したときの本文を取り出す。
 * 失敗（ステータスが 2xx 以外）なら、ApiError を投げる。
 * 型からは、エラーの本文（{ error: string }）と、入力検証のエラーの本文（{ success: false, ... }）が取り除かれる。
 */
type ErrorBody = { error: string } | { success: false };

export async function unwrap<R extends JsonResponse>(
  request: Promise<R>,
): Promise<Exclude<BodyOf<R>, ErrorBody>> {
  const response = await request;
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new ApiError(response.status, typeof body?.error === "string" ? body.error : "unknown");
  }
  return body as Exclude<BodyOf<R>, ErrorBody>;
}

const MESSAGES: Record<string, string> = {
  unauthorized: "ログインの有効期限が切れました。Discord で /uc-admin-dashboard を実行して、新しいリンクで入り直してください",
  invalid_or_expired: "このリンクは、使用済みか、期限切れです。Discord で /uc-admin-dashboard を実行して、新しいリンクを発行してください",
  already_exists: "すでに登録されています",
  already_raised: "このチームは、その対戦枠にすでに挙手しています",
  slot_matched: "その試合は、すでにマッチングが済んでいます（挙手の追加も取り消しもできません）",
  slot_not_matched: "その対戦枠は、まだマッチングが済んでいません",
  team_not_found: "チームが見つかりません",
  team_already_matched: "そのチームは、この対戦枠で、すでに別の組分けに入っています",
  win_exists: "この組分けには、すでに勝利が記録されています。削除してから、記録し直してください",
  team_not_in_match: "勝ったチームは、この組分けの2チームのどちらかを選んでください",
  slot_not_found: "その時刻は、試合時刻として登録されていません",
  not_found: "対象が見つかりません（すでに削除された可能性があります）",
  image_required: "画像を選んでください",
  unsupported_image: "画像（PNG・JPEG・WebP・GIF）を選んでください",
  image_too_large: "画像は8MB以下にしてください",
  discord_unavailable: "Discord からロール一覧を取得できませんでした",
  invalid_input: "入力内容を確認してください",
};

/** ユーザーに見せるエラーの文面 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400 && !(error.code in MESSAGES)) return MESSAGES.invalid_input ?? "入力内容を確認してください";
    return MESSAGES[error.code] ?? `エラーが発生しました（${error.status}）`;
  }
  return "通信に失敗しました。もう一度お試しください";
}
