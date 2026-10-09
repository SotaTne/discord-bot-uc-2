import { systemClock } from "@uc/core";
import { createApp } from "./app";
import type { AppEnv } from "./env";

// 本番の入口。開発専用のコード（src/dev/）は、ここからも、ここから辿るどのファイルからも、読み込まない。
// 開発専用の入口は、src/dev/entry.ts（`pnpm dev` だけが使う）。
// cron は、Cloudflare の Cron Trigger ではなく、外のタイマー（apps/cron）が、POST /cron で起こす（scheduled は、持たない）。
export default { fetch: createApp({ clock: systemClock }).fetch } satisfies ExportedHandler<AppEnv>;
