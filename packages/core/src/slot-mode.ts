import { slotStart } from "./slot-time";

/**
 * 対戦枠への、管理者の操作の「モード」。
 * - operate（運営）: マッチング前で、試合開始前。挙手を直して、マッチングを実行できる（実行すると、Discord に投稿する）
 * - correct（補正）: マッチング済み、または試合開始後。記録を直すだけで、マッチングはしない
 * 通常は、締切に cron がマッチングを済ませるので、「締切のあとは補正」になる。
 * cron が失敗して、未マッチングのまま締切を過ぎても、試合開始までは、運営（マッチングを実行できる）。
 */
export type SlotMode = "operate" | "correct";

export type SlotOperations = {
  mode: SlotMode;
  /** マッチング処理を実行できる（運営モード）。Discord に、結果を投稿する */
  canRunMatching: boolean;
  /** やり直せる（マッチング済みで、試合開始前）。組分けを全部消して、未マッチングに戻す */
  canReopen: boolean;
  /** 組分けの追加・削除を、Discord に知らせる選択ができる（マッチング済みで、試合開始前）。試合開始後は、知らせない */
  canNotifyEdit: boolean;
};

/** その対戦枠に、いま、何ができるか。API・usecase・画面は、すべて、これを使う */
export function slotOperations(input: { now: Date; slotDate: string; slotHour: number; matched: boolean }): SlotOperations {
  const started = input.now.getTime() >= slotStart(input.slotDate, input.slotHour).getTime();
  const mode: SlotMode = input.matched || started ? "correct" : "operate";
  return {
    mode,
    canRunMatching: !input.matched && !started,
    canReopen: input.matched && !started,
    canNotifyEdit: input.matched && !started,
  };
}
