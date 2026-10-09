import { systemClock } from "@uc/core";
import { createApp } from "./app";
import { createWorker } from "./worker";

// 本番の入口。開発専用のコード（src/dev/）は、ここからも、ここから辿るどのファイルからも、読み込まない。
// 開発専用の入口は、src/dev/entry.ts（`pnpm dev` だけが使う）。
export default createWorker(createApp({ clock: systemClock }), systemClock);
