import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ActionResult } from "./api";
import { useNotice } from "./notice";
import { STATE_KEY } from "./mockState";

/**
 * サーバーの操作を送る。結果が失敗なら、理由を、通知に出す。終わったら、状態を取り直す。
 * 通信そのものが失敗したときも、同じように、通知に出す。
 */
export function useAction(send: (input: FormData) => Promise<Response>) {
  const queryClient = useQueryClient();
  const { notify } = useNotice();
  return useMutation({
    mutationFn: async (form: FormData): Promise<ActionResult> => {
      try {
        return (await (await send(form)).json()) as ActionResult;
      } catch {
        return { ok: false, notice: "疑似 Discord のサーバーに接続できませんでした" };
      }
    },
    onSuccess: (result) => {
      if (!result.ok && result.notice) notify(result.notice);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATE_KEY }),
  });
}

export const formOf = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};
