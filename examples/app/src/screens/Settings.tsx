import { backoffDelay, DEFAULT_RETRY, parseRetryAfter } from "@nijatk/react-native-queuekit";
import { useState } from "react";
import { View } from "react-native";
import { rebuildRuntime, useRuntime } from "../runtime";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import { notify } from "../toast";
import {
  Body,
  Btn,
  Card,
  Chip,
  Code,
  Heading,
  NumberField,
  Row,
  Screen,
  TextField,
  Toggle,
} from "../ui";

function BackoffPreview({ retry }: Readonly<{ retry: Settings["retry"] }>) {
  const delays = Array.from({ length: Math.max(0, retry.maxAttempts - 1) }, (_, i) => {
    const high = backoffDelay(i + 1, retry, () => 1);
    const low = retry.jitter ? backoffDelay(i + 1, retry, () => 0) : high;
    return low === high ? `${high} ms` : `${low}-${high} ms`;
  });
  return (
    <Code>
      {delays.length
        ? delays.map((d, i) => `after failure ${i + 1}: ${d}`).join("\n")
        : "no retries"}
    </Code>
  );
}

function Helpers() {
  const [header, setHeader] = useState("120");
  const parsed = parseRetryAfter(header);
  return (
    <Card
      title="parseRetryAfter()"
      hint="Turns an HTTP Retry-After header (seconds or a date) into milliseconds."
    >
      <TextField label="Header value" value={header} onChange={setHeader} />
      <Code>{parsed === undefined ? "undefined (not parseable)" : `${parsed} ms`}</Code>
      <Code>{`DEFAULT_RETRY = ${JSON.stringify(DEFAULT_RETRY)}`}</Code>
    </Card>
  );
}

function Storage() {
  const { storage, settings } = useRuntime();
  const [keys, setKeys] = useState<string[]>([]);
  return (
    <Card
      title="Storage"
      hint="What is really on disk. Payloads are stored as plain JSON unless the storage itself is encrypted."
    >
      <Row wrap>
        <Btn label="List keys" small kind="ghost" onPress={() => setKeys(storage.getAllKeys())} />
        <Btn
          label="Wipe storage"
          small
          kind="danger"
          onPress={() => {
            storage.clearAll();
            rebuildRuntime();
            setKeys([]);
            notify("Storage wiped", "ok");
          }}
        />
      </Row>
      <Body muted>Backend: {settings.storage}</Body>
      {keys.length ? <Code>{keys.join("\n")}</Code> : null}
    </Card>
  );
}

export function SettingsScreen() {
  const { settings } = useRuntime();
  const [draft, setDraft] = useState<Settings>(settings);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const setRetry = <K extends keyof Settings["retry"]>(key: K, value: Settings["retry"][K]) =>
    setDraft((prev) => ({ ...prev, retry: { ...prev.retry, [key]: value } }));

  return (
    <Screen>
      <Heading>Settings</Heading>
      <Body muted>
        These are createQueue() options. Press Apply to restart the queue with them; saved jobs are
        kept.
      </Body>

      <Card
        title="Storage backend"
        hint="MMKV survives restarts. Memory loses everything when the app closes."
      >
        <Row>
          <Chip
            label="MMKV"
            active={draft.storage === "mmkv"}
            onPress={() => set("storage", "mmkv")}
          />
          <Chip
            label="Memory"
            active={draft.storage === "memory"}
            onPress={() => set("storage", "memory")}
          />
        </Row>
      </Card>

      <Card title="Execution">
        <Row>
          <View style={{ flex: 1 }}>
            <NumberField
              label="concurrency"
              value={draft.concurrency}
              onChange={(v) => set("concurrency", v)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField
              label="timeoutMs"
              value={draft.timeoutMs}
              onChange={(v) => set("timeoutMs", v)}
            />
          </View>
        </Row>
        <NumberField
          label="maxPayloadBytes"
          value={draft.maxPayloadBytes}
          onChange={(v) => set("maxPayloadBytes", v)}
          hint="Larger payloads make enqueue() throw. 0 turns the limit off."
        />
        <Toggle
          label="strict"
          hint="Throw when a job type is defined twice with different handlers."
          value={draft.strict}
          onChange={(v) => set("strict", v)}
        />
        <Toggle
          label="lease"
          hint="Let only one instance sharing this storage run jobs (3 s lease here)."
          value={draft.lease}
          onChange={(v) => set("lease", v)}
        />
      </Card>

      <Card title="Retry policy" hint="Backoff doubles from the base delay up to the maximum.">
        <Row>
          <View style={{ flex: 1 }}>
            <NumberField
              label="maxAttempts"
              value={draft.retry.maxAttempts}
              onChange={(v) => setRetry("maxAttempts", v)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField
              label="baseDelayMs"
              value={draft.retry.baseDelayMs}
              onChange={(v) => setRetry("baseDelayMs", v)}
            />
          </View>
        </Row>
        <NumberField
          label="maxDelayMs"
          value={draft.retry.maxDelayMs}
          onChange={(v) => setRetry("maxDelayMs", v)}
        />
        <Toggle label="jitter" value={draft.retry.jitter} onChange={(v) => setRetry("jitter", v)} />
        <BackoffPreview retry={draft.retry} />
      </Card>

      <Card
        title="Limits for demo.limited"
        hint="Per-type concurrency and rate limit (limits option)."
      >
        <Toggle
          label="enabled"
          value={draft.limitedEnabled}
          onChange={(v) => set("limitedEnabled", v)}
        />
        <Row>
          <View style={{ flex: 1 }}>
            <NumberField
              label="concurrency"
              value={draft.limitedConcurrency}
              onChange={(v) => set("limitedConcurrency", v)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField
              label="rate.max"
              value={draft.limitedRateMax}
              onChange={(v) => set("limitedRateMax", v)}
            />
          </View>
        </Row>
        <NumberField
          label="rate.perMs"
          value={draft.limitedRatePerMs}
          onChange={(v) => set("limitedRatePerMs", v)}
        />
      </Card>

      <Card title="Retention of failed jobs" hint="Deleted jobs emit removed. 0 turns a limit off.">
        <Toggle
          label="enabled"
          value={draft.retentionEnabled}
          onChange={(v) => set("retentionEnabled", v)}
        />
        <Row>
          <View style={{ flex: 1 }}>
            <NumberField
              label="maxFailed"
              value={draft.maxFailed}
              onChange={(v) => set("maxFailed", v)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <NumberField
              label="failedTtlMs"
              value={draft.failedTtlMs}
              onChange={(v) => set("failedTtlMs", v)}
            />
          </View>
        </Row>
      </Card>

      <Row>
        <View style={{ flex: 1 }}>
          <Btn
            label="Apply and restart queue"
            onPress={() => {
              rebuildRuntime(draft);
              notify("Queue restarted", "ok");
            }}
          />
        </View>
        <Btn label="Defaults" kind="ghost" onPress={() => setDraft(DEFAULT_SETTINGS)} />
      </Row>

      <Storage />
      <Helpers />
    </Screen>
  );
}
