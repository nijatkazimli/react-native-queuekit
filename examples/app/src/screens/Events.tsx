import type { QueueEvent } from "@nijatk/react-native-queuekit";
import { useState } from "react";
import { Text } from "react-native";
import { clearLog, type LogEntry, useLog } from "../eventLog";
import { colors } from "../theme";
import { Badge, Body, Btn, Card, Chip, Code, Heading, Row, Screen } from "../ui";

const EVENTS: QueueEvent[] = [
  "enqueued",
  "started",
  "completed",
  "retry",
  "failed",
  "expired",
  "removed",
  "requeued",
];

const eventColor: Record<QueueEvent, string> = {
  enqueued: colors.muted,
  started: colors.active,
  completed: colors.ok,
  retry: colors.warn,
  failed: colors.bad,
  expired: colors.warn,
  removed: colors.muted,
  requeued: colors.accent,
};

const time = (at: number) => new Date(at).toTimeString().slice(0, 8);
const show = (value: unknown) => (value === undefined ? "" : JSON.stringify(value));

function Entry({ entry }: Readonly<{ entry: LogEntry }>) {
  const detail = [
    `attempts used: ${entry.attempt}`,
    entry.durationMs === undefined ? "" : `${entry.durationMs} ms`,
    entry.error ? `error: ${entry.error}` : "",
    entry.result === undefined ? "" : `result: ${show(entry.result)}`,
  ].filter(Boolean);
  return (
    <Card>
      <Row>
        <Badge label={entry.event} color={eventColor[entry.event]} />
        <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>{entry.type}</Text>
        <Text style={{ color: colors.muted, fontSize: 11 }}>
          {entry.instance} | {time(entry.at)}
        </Text>
      </Row>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{detail.join(" | ")}</Text>
      <Code>
        {entry.sensitive
          ? "payload: (hidden, job is sensitive)"
          : `payload: ${show(entry.payload)}`}
      </Code>
    </Card>
  );
}

export function EventsScreen() {
  const entries = useLog();
  const [hidden, setHidden] = useState<Set<QueueEvent>>(new Set());
  const toggle = (event: QueueEvent) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(event)) next.add(event);
      return next;
    });
  const shown = entries.filter((entry) => !hidden.has(entry.event));
  return (
    <Screen>
      <Heading>Events</Heading>
      <Body muted>
        Everything queue.observe() reports, newest first: durations, results and errors. Instance
        letters show which queue emitted it (see the Dashboard lease lab).
      </Body>
      <Row wrap>
        {EVENTS.map((event) => (
          <Chip
            key={event}
            label={event}
            active={!hidden.has(event)}
            onPress={() => toggle(event)}
          />
        ))}
      </Row>
      <Row>
        <Text style={{ color: colors.muted, flex: 1 }}>{shown.length} shown</Text>
        <Btn label="Clear log" small kind="ghost" onPress={clearLog} />
      </Row>
      {shown.map((entry) => (
        <Entry key={entry.id} entry={entry} />
      ))}
    </Screen>
  );
}
