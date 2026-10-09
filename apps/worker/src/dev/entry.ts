import { systemClock } from "@uc/core";
import type { AppEnv } from "../env";
import { createDevApp } from "./app";
import { devClock } from "./clock";

// 開発の入口。`pnpm dev`（wrangler dev src/dev/entry.ts）だけが使う。本番の入口は、src/index.ts。
// 本番と同じアプリに、開発専用のルート（/dev/*）と、疑似時計（本物の時刻 + ずれ）を足す。
const clock = devClock(systemClock);
export default { fetch: createDevApp({ clock }).fetch } satisfies ExportedHandler<AppEnv>;
