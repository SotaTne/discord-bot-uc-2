import { ActionIcon, Button } from "@mantine/core";
import { useState } from "react";
import { formOf, useAction } from "../actions";
import { mockApi } from "../api";
import type { MockStateData } from "../mockState";
import { formatOffset, jstDate, jstHm, jstMdWeekday } from "../time";

/**
 * 時計。疑似時計の時刻を、大きく出す。日付（1 日ずつ前後）・時刻（直せる）・出来事の時刻へ移るボタン・現在時刻。
 * 時計は「本物の時刻 + ずれ」で、移っても、時間は進む。ずれは、「本物より +8時間12分」のように出す。
 * 時計を動かすと、worker の cron が、自動で動く。
 */
export function ClockBar({ state }: { state: MockStateData }) {
  const { now, real, offsetMs } = state.clock;
  const offset = formatOffset(offsetMs);
  const date = jstDate(now);
  const clock = useAction((form) => mockApi.clock.$post({}, { init: { body: form } }));
  const move = (fields: Record<string, string>) => clock.mutate(formOf(fields));
  // 時刻の入力は、入力している途中は、サーバーの値で、上書きしない
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <header className="surface clock">
      <div className="clock-main">
        <div className="clock-date">
          <ActionIcon variant="default" size="lg" aria-label="前の日" onClick={() => move({ action: "day", value: "-1" })}>
            ◀
          </ActionIcon>
          <strong>{jstMdWeekday(now)}</strong>
          <ActionIcon variant="default" size="lg" aria-label="次の日" onClick={() => move({ action: "day", value: "1" })}>
            ▶
          </ActionIcon>
        </div>

        <input
          className="clock-time"
          type="time"
          aria-label="いまの時刻"
          value={draft ?? jstHm(now)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => {
            if (event.target.value && event.target.value !== jstHm(now)) move({ action: "set", value: `${date}T${event.target.value}` });
            setDraft(null);
          }}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />

        <div className="clock-steps">
          {state.clockSteps.map((step) => {
            const active = jstHm(step.at) === jstHm(now);
            // ラベルは「20:53 21時の締切」の形。時刻は太く、説明は、その下に出す
            const description = step.label.replace(/^\d\d:\d\d\s*/, "");
            return (
              <button key={step.label} type="button" className="step" aria-pressed={active} onClick={() => move({ action: "set", value: `${date}T${jstHm(step.at)}` })}>
                <b>{jstHm(step.at)}</b> <span>{description}</span>
              </button>
            );
          })}
        </div>
        {/* 本物の時刻より、どれだけずれているか（幅が揺れないよう、いつも場所を取る） */}
        <span className="clock-offset" aria-live="polite">
          {offset ? `本物より ${offset}` : "本物の時刻"}
        </span>
        <Button variant={real ? "light" : "default"} aria-pressed={real} onClick={() => move({ action: "real" })}>
          現在時刻
        </Button>
      </div>
    </header>
  );
}
