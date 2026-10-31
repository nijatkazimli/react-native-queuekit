import type { EnqueueOptions } from "@nijatk/react-native-queuekit";
import { useState } from "react";
import { View } from "react-native";
import { JOB_TYPES, OLD_PROFILE_JOB, redefineSuccess } from "../jobs";
import { QUEUE_NAME, type Runtime, rebuildRuntime, useRuntime } from "../runtime";
import { attempt, notify } from "../toast";
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

interface Scenario {
  title: string;
  tests: string;
  actions: { label: string; kind?: "primary" | "ghost" | "danger"; run: (rt: Runtime) => void }[];
}

const SCENARIOS: Scenario[] = [
  {
    title: "Progress and result",
    tests: "define(), ctx.progress(), the handler result on the completed event (see Events).",
    actions: [{ label: "Run 3 s job", run: ({ jobs }) => jobs.success({ ms: 3000 }) }],
  },
  {
    title: "Retry with backoff",
    tests: "Fails twice, then succeeds. Watch retry events and the growing delay.",
    actions: [{ label: "Fail 2 times", run: ({ jobs }) => jobs.flaky({ failUntil: 2 }) }],
  },
  {
    title: "Runs out of attempts",
    tests: "maxAttempts: 2, then the job stays failed. Retry or remove it from the Queue tab.",
    actions: [
      {
        label: "Always fails",
        run: ({ jobs }) => jobs.alwaysFail({ code: 500 }, { maxAttempts: 2 }),
      },
    ],
  },
  {
    title: "NonRetryableError",
    tests: "Gives up on the first attempt, no retries.",
    actions: [{ label: "Fatal error", run: ({ jobs }) => jobs.fatal({}) }],
  },
  {
    title: "RetryAfterError",
    tests: "The first attempt asks to wait 4 s (like HTTP 429 with Retry-After).",
    actions: [{ label: "Rate limited", run: ({ jobs }) => jobs.retryAfter({ delayMs: 4000 }) }],
  },
  {
    title: "Per-job timeout",
    tests: "timeoutMs: 2000 on a handler that never ends. TimeoutError, then a retry.",
    actions: [
      {
        label: "Hang for 2 s",
        run: ({ jobs }) => jobs.hang({}, { timeoutMs: 2000, maxAttempts: 2 }),
      },
    ],
  },
  {
    title: "Cancel a running job",
    tests: "Runs until you remove it in the Queue tab; the handler's AbortSignal fires.",
    actions: [
      { label: "Start long job", run: ({ jobs }) => jobs.hang({}, { timeoutMs: 10 * 60_000 }) },
    ],
  },
  {
    title: "Generator handler",
    tests: "An async generator: each yield is a checkpoint where cancellation is noticed.",
    actions: [{ label: "8 chunks", run: ({ jobs }) => jobs.resumable({ chunks: 8 }) }],
  },
  {
    title: "Detached native task",
    tests: "ctx.detach(): the job stays active until you press Complete or Fail in the Queue tab.",
    actions: [{ label: "Hand off", run: ({ jobs }) => jobs.native({ file: "video.mp4" }) }],
  },
  {
    title: "Network awareness",
    tests:
      "Switch Simulated offline on (Dashboard) first. The first waits; the second runs anyway.",
    actions: [
      { label: "Needs network", run: ({ jobs }) => jobs.success({ ms: 1500 }) },
      {
        label: "requiresNetwork: false",
        kind: "ghost",
        run: ({ jobs }) => jobs.success({ ms: 1500 }, { requiresNetwork: false }),
      },
    ],
  },
  {
    title: "Priority",
    tests:
      "Stops the queue, adds priorities -5, 0 and 10, then starts. Check the start order in Events.",
    actions: [
      {
        label: "Enqueue 3",
        run: ({ queue, jobs }) => {
          queue.stop();
          jobs.success({ ms: 1200 }, { priority: -5, id: `low-${Date.now()}` });
          jobs.success({ ms: 1200 }, { priority: 0, id: `mid-${Date.now()}` });
          jobs.success({ ms: 1200 }, { priority: 10, id: `high-${Date.now()}` });
          queue.start();
        },
      },
    ],
  },
  {
    title: "Delay",
    tests: "delayMs: 5000. The job waits in pending until it is due.",
    actions: [
      { label: "Start in 5 s", run: ({ jobs }) => jobs.success({ ms: 1000 }, { delayMs: 5000 }) },
    ],
  },
  {
    title: "Expiry (ttlMs)",
    tests: "Due in 6 s but expires after 4 s, so it is dropped with an expired event.",
    actions: [
      {
        label: "Expire before it runs",
        run: ({ jobs }) => jobs.success({ ms: 1000 }, { delayMs: 6000, ttlMs: 4000 }),
      },
    ],
  },
  {
    title: "Dedupe",
    tests: "Three enqueues with one dedupeKey create a single job.",
    actions: [
      {
        label: "Enqueue 3 times",
        run: ({ jobs }) => {
          const ids = new Set<string>();
          for (let i = 0; i < 3; i++) ids.add(jobs.success({ ms: 4000 }, { dedupeKey: "sync" }).id);
          notify(`3 calls created ${ids.size} job`, "ok");
        },
      },
    ],
  },
  {
    title: "Ordered chain (orderKey)",
    tests:
      "Step 1 fails twice. With one orderKey, steps 2 and 3 wait for it; without, they run first.",
    actions: [
      {
        label: "With orderKey",
        run: ({ jobs }) => {
          jobs.step({ n: 1, failFirst: 2 }, { orderKey: "chat-1" });
          jobs.step({ n: 2, failFirst: 0 }, { orderKey: "chat-1" });
          jobs.step({ n: 3, failFirst: 0 }, { orderKey: "chat-1" });
        },
      },
      {
        label: "Without",
        kind: "ghost",
        run: ({ jobs }) => {
          jobs.step({ n: 1, failFirst: 2 });
          jobs.step({ n: 2, failFirst: 0 });
          jobs.step({ n: 3, failFirst: 0 });
        },
      },
    ],
  },
  {
    title: "Concurrency and rate limits",
    tests: "8 jobs of a limited type: one at a time and at most 3 starts per 6 s (see Settings).",
    actions: [
      {
        label: "Burst of 8",
        run: ({ jobs }) => {
          for (let n = 1; n <= 8; n++) jobs.limited({ n });
        },
      },
    ],
  },
  {
    title: "Sensitive payloads",
    tests:
      "The sensitive job's payload and result are hidden in Events; the other one's are shown.",
    actions: [
      {
        label: "sensitive: true",
        run: ({ jobs }) => jobs.sensitive({ pin: "1234" }, { sensitive: true }),
      },
      { label: "Normal", kind: "ghost", run: ({ jobs }) => jobs.sensitive({ pin: "1234" }) },
    ],
  },
  {
    title: "Payload size limit",
    tests:
      "A payload over maxPayloadBytes (Settings) makes enqueue() throw before saving anything.",
    actions: [
      {
        label: "Enqueue too large",
        kind: "danger",
        run: ({ queue, settings }) =>
          attempt(() =>
            queue.enqueue("demo.success", {
              ms: 500,
              blob: "x".repeat((settings.maxPayloadBytes || 4096) + 100),
            }),
          ),
      },
    ],
  },
  {
    title: "Secret-looking keys",
    tests:
      "A key named like a token logs a development warning (Metro console). sensitive: true silences it.",
    actions: [
      {
        label: "apiToken in payload",
        run: ({ queue }) => queue.enqueue("demo.success", { ms: 500, apiToken: "abc123" }),
      },
    ],
  },
  {
    title: "Strict define()",
    tests: "Defining a type twice with a different handler throws while strict is on (Settings).",
    actions: [
      {
        label: "Redefine demo.success",
        kind: "danger",
        run: ({ queue }) =>
          attempt(() => redefineSuccess(queue), "Replaced silently (strict is off)"),
      },
    ],
  },
  {
    title: "Payload migration",
    tests:
      "Writes a version 1 job straight into storage, then restarts the queue. It loads upgraded.",
    actions: [
      {
        label: "Write v1 job and restart",
        run: ({ storage }) => {
          const id = `old-${Date.now()}`;
          storage.set(
            `queuekit:${QUEUE_NAME}:job:${id}`,
            JSON.stringify(OLD_PROFILE_JOB(id, "Ada Lovelace")),
          );
          rebuildRuntime();
          notify("Check the Queue tab: payload is { name } now", "ok");
        },
      },
    ],
  },
  {
    title: "Crash recovery",
    tests: "Starts a long job, then restarts the queue mid-run. The interrupted job runs again.",
    actions: [
      { label: "1. Start long job", run: ({ jobs }) => jobs.hang({}, { timeoutMs: 10 * 60_000 }) },
      { label: "2. Restart queue", kind: "ghost", run: () => rebuildRuntime() },
    ],
  },
  {
    title: "Retention of failed jobs",
    tests:
      "Turn retention on in Settings, then add 5 failures: the oldest are deleted (removed events).",
    actions: [
      {
        label: "5 failing jobs",
        run: ({ jobs }) => {
          for (let i = 0; i < 5; i++) jobs.fatal({});
        },
      },
    ],
  },
];

const PRESETS: Record<string, string> = {
  "demo.success": '{ "ms": 2000 }',
  "demo.flaky": '{ "failUntil": 2 }',
  "demo.alwaysFail": '{ "code": 503 }',
  "demo.fatal": "{}",
  "demo.retryAfter": '{ "delayMs": 3000 }',
  "demo.hang": "{}",
  "demo.resumable": '{ "chunks": 6 }',
  "demo.native": '{ "file": "photo.jpg" }',
  "demo.sensitive": '{ "pin": "1234" }',
  "demo.step": '{ "n": 1, "failFirst": 1 }',
  "demo.limited": '{ "n": 1 }',
  "demo.profile": '{ "name": "Grace" }',
};

function CustomJob({ runtime }: Readonly<{ runtime: Runtime }>) {
  const [type, setType] = useState<string>(JOB_TYPES[0]);
  const [payload, setPayload] = useState(PRESETS[JOB_TYPES[0]] ?? "{}");
  const [priority, setPriority] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(0);
  const [delayMs, setDelayMs] = useState(0);
  const [ttlMs, setTtlMs] = useState(0);
  const [timeoutMs, setTimeoutMs] = useState(0);
  const [dedupeKey, setDedupeKey] = useState("");
  const [orderKey, setOrderKey] = useState("");
  const [id, setId] = useState("");
  const [requiresNetwork, setRequiresNetwork] = useState(true);
  const [sensitive, setSensitive] = useState(false);

  const enqueue = () => {
    attempt(() => {
      const options: EnqueueOptions = {
        priority,
        requiresNetwork,
        sensitive,
        maxAttempts: maxAttempts || undefined,
        delayMs: delayMs || undefined,
        ttlMs: ttlMs || undefined,
        timeoutMs: timeoutMs || undefined,
        dedupeKey: dedupeKey || undefined,
        orderKey: orderKey || undefined,
        id: id || undefined,
      };
      runtime.queue.enqueue(type, JSON.parse(payload), options);
    }, "Enqueued");
  };

  return (
    <Card
      title="Custom job"
      hint="Builds any enqueue() call by hand: pick a type, edit the payload, set options. 0 or empty means not set."
    >
      <Row wrap>
        {JOB_TYPES.map((name) => (
          <Chip
            key={name}
            label={name.replace("demo.", "")}
            active={type === name}
            onPress={() => {
              setType(name);
              setPayload(PRESETS[name] ?? "{}");
            }}
          />
        ))}
      </Row>
      <TextField label="Payload (JSON)" value={payload} onChange={setPayload} />
      <Row>
        <View style={{ flex: 1 }}>
          <NumberField label="priority" value={priority} onChange={setPriority} />
        </View>
        <View style={{ flex: 1 }}>
          <NumberField label="maxAttempts" value={maxAttempts} onChange={setMaxAttempts} />
        </View>
      </Row>
      <Row>
        <View style={{ flex: 1 }}>
          <NumberField label="delayMs" value={delayMs} onChange={setDelayMs} />
        </View>
        <View style={{ flex: 1 }}>
          <NumberField label="ttlMs" value={ttlMs} onChange={setTtlMs} />
        </View>
      </Row>
      <NumberField label="timeoutMs" value={timeoutMs} onChange={setTimeoutMs} />
      <TextField label="dedupeKey" value={dedupeKey} onChange={setDedupeKey} />
      <TextField label="orderKey" value={orderKey} onChange={setOrderKey} />
      <TextField label="id" value={id} onChange={setId} placeholder="generated if empty" />
      <Toggle label="requiresNetwork" value={requiresNetwork} onChange={setRequiresNetwork} />
      <Toggle label="sensitive" value={sensitive} onChange={setSensitive} />
      <Btn label={`queue.enqueue("${type}", ...)`} onPress={enqueue} />
    </Card>
  );
}

export function LabScreen() {
  const runtime = useRuntime();
  return (
    <Screen>
      <Heading>Lab</Heading>
      <Body muted>
        Every card exercises one feature. Watch the result in the Queue and Events tabs.
      </Body>
      <CustomJob runtime={runtime} />
      {SCENARIOS.map((scenario) => (
        <Card key={scenario.title} title={scenario.title} hint={scenario.tests}>
          <Row wrap>
            {scenario.actions.map((action) => (
              <Btn
                key={action.label}
                label={action.label}
                kind={action.kind ?? "primary"}
                small
                onPress={() => attempt(() => action.run(runtime))}
              />
            ))}
          </Row>
        </Card>
      ))}
      <Code>{`createQueue({ name: "${QUEUE_NAME}", ... })`}</Code>
    </Screen>
  );
}
