import { DiscordApiError } from "@uc/discord";
import type { CommandContext } from "./registry";

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 300;

/**
 * deferred（考え中）で返した応答の、本文をあとから書き換える。
 *
 * Discord が最初の応答（考え中）をまだ受け取っていない間は、編集が 404 になることがある。
 * 処理がすぐ終わったときに起こるので、404 のときだけ、少し待ってやり直す（ほかのエラーはやり直さない）。
 */
export async function editDeferredResponse(context: CommandContext, content: string): Promise<void> {
  const { interaction, rest, sleep } = context;

  for (let attempt = 1; ; attempt++) {
    try {
      await rest.editOriginalResponse(interaction.application_id, interaction.token, {
        content,
        allowed_mentions: { parse: [] },
      });
      return;
    } catch (error) {
      const retryable = error instanceof DiscordApiError && error.status === 404 && attempt < MAX_ATTEMPTS;
      if (!retryable) throw error;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}
