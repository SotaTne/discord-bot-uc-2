import { ActionIcon, Button, Group, Text } from "@mantine/core";
import { useState } from "react";
import { formOf, useAction } from "../actions";
import { mockApi } from "../api";
import type { MockStateData } from "../mockState";
import { jstDate, jstHm, jstMdWeekday } from "../time";

/**
 * 時計。疑似時計の時刻を、大きく出す。日付（1 日ずつ前後）・時刻（直せる）・イベントの時刻へ移るボタン・現在時刻。
 * 時計を動かすと、worker の cron が、自動で動く。
 */
export function ClockBar({ state }: { state: MockStateData }) {
  const { now, real } = state.clock;
  const date = jstDate(now);
  const clock = useAction((form) => mockApi.clock.$post({}, { init: { body: form } }));
  const move = (fields: Record<string, string>) => clock.mutate(formOf(fields));
  // 時刻の入力は、入力している途中は、サーバーの値で、上書きしない
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Group component="header" gap="md" align="center" wrap="wrap">
      <Group gap="xs">
        <ActionIcon variant="default" size="lg" aria-label="前の日" onClick={() => move({ action: "day", value: "-1" })}>
          ◀
        </ActionIcon>
        <Text fw={600} ta="center" miw="5.5em">
          {jstMdWeekday(now)}
        </Text>
        <ActionIcon variant="default" size="lg" aria-label="次の日" onClick={() => move({ action: "day", value: "1" })}>
          ▶
        </ActionIcon>
      </Group>

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
        style={{ border: "1px solid transparent", background: "transparent", color: "inherit", font: "inherit", padding: "2px 8px", borderRadius: 6 }}
      />

      <Group gap={6} style={{ flex: 1 }}>
        {state.clockSteps.map((step) => (
          <Button
            key={step.label}
            size="compact-sm"
            variant={jstHm(step.at) === jstHm(now) ? "light" : "default"}
            aria-pressed={jstHm(step.at) === jstHm(now)}
            onClick={() => move({ action: "set", value: `${date}T${jstHm(step.at)}` })}
          >
            {step.label}
          </Button>
        ))}
      </Group>

      <Button size="compact-sm" variant={real ? "light" : "default"} aria-pressed={real} onClick={() => move({ action: "real" })}>
        現在時刻
      </Button>
    </Group>
  );
}
