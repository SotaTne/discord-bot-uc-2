import type { DevSnapshot } from "@uc/api";
import { commands } from "@uc/discord";
import { Hono, type Context } from "hono";
import type { createDiscordInteractions } from "../discord/interactions";
import type { MockState } from "../discord/state";
import { clockSteps } from "./clock-steps";
import { parseJstDateTime } from "./time";
import type { WorkerDev } from "./worker-dev";

export type MockApiDeps = {
  state: MockState;
  interactions: ReturnType<typeof createDiscordInteractions>;
  workerDev: WorkerDev;
};

type ActionResult = { ok: boolean; notice: string };

const errorText = (error: unknown) => (error instanceof Error ? error.message : "不明なエラー");

/**
 * 画面用の API（JSON）。ブラウザの画面が、これだけを呼ぶ。
 * Discord のサーバー役（../discord）と、worker の開発用ルート（./worker-dev）を、組み合わせる。
 * - GET  /state        画面に出すものを、まとめて返す（時計・ユーザー・メッセージ・worker の状態）
 * - POST /send         コマンドを、選んだ実行者として、順に実行する
 * - POST /click        メッセージのボタンを押す
 * - POST /clock        時計を動かす（動かしたら、cron が動く）
 * - POST /reset        すべて初期状態に戻す
 * - GET  /screenshots/:seq   worker に保存された画像
 */
export function createMockApi(deps: MockApiDeps) {
  const { state } = deps;

  /** worker の状態。取れなかったときは、理由を返す（画面に出す） */
  async function loadSnapshot(): Promise<{ snapshot: DevSnapshot | null; snapshotError: string | null }> {
    try {
      return { snapshot: await deps.workerDev.fetchSnapshot(), snapshotError: null };
    } catch (error) {
      return { snapshot: null, snapshotError: errorText(error) };
    }
  }

  /** 操作を実行して、結果を JSON で返す。例外は、画面に出す文面にする */
  async function perform(c: Context, run: (form: Record<string, string | File>) => Promise<ActionResult>) {
    const raw = await c.req.parseBody();
    const form = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? (value[0] ?? "") : value]),
    ) as Record<string, string | File>;
    try {
      return c.json(await run(form));
    } catch (error) {
      return c.json({ ok: false, notice: errorText(error) });
    }
  }

  /** 時計を動かしたあとの、cron。本番と同じに、時刻が来れば、自動で動く */
  async function tickAfterClockChange(): Promise<ActionResult> {
    const summary = await deps.workerDev.tick();
    return summary.errors.length === 0
      ? { ok: true, notice: "" }
      : { ok: false, notice: `cron のエラー: ${summary.errors.join(" / ")}` };
  }

  return new Hono()
    .get("/state", async (c) => {
      const { snapshot, snapshotError } = await loadSnapshot();
      const now = state.now();
      return c.json({
        guildId: state.guildId,
        channelId: state.channelId,
        users: state.users,
        roles: state.roles,
        messages: state.messages,
        clock: { now, real: state.clockIso() === null },
        // 時計を移せるイベント（募集開始・各対戦枠の締切・試合開始）。worker の状態から作る
        clockSteps: clockSteps(snapshot),
        snapshot,
        snapshotError,
      });
    })

    // 記録した勝利の画像（worker の R2 から取って、そのまま返す）
    .get("/screenshots/:seq", async (c) => {
      const response = await deps.workerDev.fetchScreenshot(c.req.param("seq")).catch(() => null);
      if (!response?.ok) return c.text("not found", 404);
      return new Response(response.body, {
        headers: {
          "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream",
          "Cache-Control": "private, max-age=300",
        },
      });
    })

    // コマンドの実行。フォームの項目は、コマンドの定義（@uc/discord）に従って、オプションにする。
    // 実行者が複数なら、選んだ順に、1人ずつ実行する
    .post("/send", (c) =>
      perform(c, async (form) => {
        const name = String(form.command ?? "");
        const definition = commands.find((command) => command.name === name);
        if (!definition) throw new Error(`コマンドが見つかりません: ${name}`);

        const userIds = String(form.users ?? "").split(",").filter(Boolean);
        if (userIds.length === 0) throw new Error("実行者を選んでください");

        const options: Record<string, string | number> = {};
        for (const option of definition.options ?? []) {
          const value = form[option.name];
          if (value instanceof File) {
            // アップロードされた画像は、添付ファイルとして渡す
            if (value.size > 0) {
              const attachment = state.addAttachment({
                filename: value.name,
                contentType: value.type || "application/octet-stream",
                bytes: new Uint8Array(await value.arrayBuffer()),
              });
              options[option.name] = attachment.id;
            }
          } else if (typeof value === "string" && value !== "") {
            options[option.name] = value;
          }
        }

        const failures: string[] = [];
        for (const userId of userIds) {
          const result = await deps.interactions.sendCommand({ userId, name, options });
          if (result.status !== 200) failures.push(`${state.userById(userId)?.username ?? userId}: worker が ${result.status} を返しました`);
        }
        return failures.length === 0 ? { ok: true, notice: "" } : { ok: false, notice: failures.join(" / ") };
      }),
    )

    // メッセージのボタンを押す。本人にだけ見えるメッセージは、その本人が押す
    .post("/click", (c) =>
      perform(c, async (form) => {
        const messageId = String(form.message_id ?? "");
        const message = state.messages.find((m) => m.id === messageId);
        const userId = message?.visibleTo ?? state.users[0]?.id ?? "";
        const result = await deps.interactions.sendComponent({ userId, customId: String(form.custom_id ?? ""), messageId });
        return result.status === 200 ? { ok: true, notice: "" } : { ok: false, notice: `worker が ${result.status} を返しました` };
      }),
    )

    // 時計を動かす（set: 指定した時刻 / day: 日を前後 / real: 現在時刻）。動かしたら、cron が自動で動く
    .post("/clock", (c) =>
      perform(c, async (form) => {
        const action = String(form.action ?? "");

        if (action === "real") {
          state.setClock(null);
        } else if (action === "day") {
          const days = Number(form.value);
          if (!Number.isInteger(days) || Math.abs(days) > 31) throw new Error("不正な操作です");
          state.setClock(state.now() + days * 86_400_000);
        } else if (action === "set") {
          const at = parseJstDateTime(String(form.value ?? ""));
          if (at === null) throw new Error("日時の形式が正しくありません");
          state.setClock(at);
        } else {
          throw new Error("不正な操作です");
        }

        return tickAfterClockChange();
      }),
    )

    // すべて初期状態に戻す（worker の活動の記録・このページのメッセージと画像・時計）
    .post("/reset", (c) =>
      perform(c, async () => {
        await deps.workerDev.resetWorkerData();
        state.reset();
        state.setClock(null);
        return { ok: true, notice: "" };
      }),
    );
}

export type MockApiType = ReturnType<typeof createMockApi>;
