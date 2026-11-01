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

// Which jobs started, oldest first. Makes ordering tests easy to read at a glance.
function counts(entries: LogEntry[]): string {
  const seen = new Map<QueueEvent, number>();
  for (const { event } of entries) seen.set(event, (seen.get(event) ?? 0) + 1);
  return EVENTS.filter((event) => seen.has(event))
    .map((event) => `${event} ${seen.get(event)}`)
    .join(", ");
}
function startOrder(entries: LogEntry[]): string {
  return entries
    .filter((entry) => entry.event === "started")
    .reverse()
    .map(({ payload, type }) => {
      const p = (payload ?? {}) as { label?: string; n?: number };
      return p.label ?? (p.n === undefined ? type : `step ${p.n}`);
    })
    .join(", ");
}

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
  const order = startOrder(entries);
  return (
    <Screen>
      <Heading>Events</Heading>
      <Body muted>
        Everything queue.observe() reports, newest first: durations, results and errors. Instance
        letters show which queue emitted it (see the Dashboard lease lab).
      </Body>
      {entries.length > 0 ? (
        <Card>
          <Text testID="event-counts" style={{ color: colors.text, fontSize: 13 }}>
            Totals: {counts(entries)}
          </Text>
          {order ? (
            <Text testID="start-order" style={{ color: colors.text, fontSize: 13 }}>
              Start order: {order}
            </Text>
          ) : null}
        </Card>
      ) : null}
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
