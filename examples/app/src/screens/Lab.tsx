import type { EnqueueOptions } from "@nijatk/react-native-queuekit";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { clearLog } from "../eventLog";
import { JOB_TYPES, OLD_PROFILE_JOB, redefineSuccess } from "../jobs";
import { setForcedOffline } from "../network";
import { QUEUE_NAME, type Runtime, rebuildRuntime, spawnFollower, useRuntime } from "../runtime";
import { DEFAULT_SETTINGS, type Settings } from "../settings";
import { colors } from "../theme";
import { attempt, notify } from "../toast";
import { Body, Btn, Card, Chip, Heading, NumberField, Row, Screen, TextField, Toggle } from "../ui";

interface Action {
  label: string;
  kind?: "primary" | "ghost" | "danger";
  run: (rt: Runtime) => void;
}

interface Test {
  title: string;
  proves: string;
  steps: string[];
  expect: string[];
  actions: Action[];
}

const withSettings = (patch: Partial<Settings>) => (rt: Runtime) =>
  rebuildRuntime({ ...rt.settings, ...patch });

const SECTIONS: { title: string; tests: Test[] }[] = [
  {
    title: "Basics",
    tests: [
      {
        title: "A job runs to the end",
        proves: "define(), progress, and the result of a handler.",
        steps: ["Press Run job.", "Open Queue: watch the progress bar.", "Open Events."],
        expect: [
          "The bar fills in about 3 seconds, then the job disappears.",
          "Events: started, then completed with result {finishedAfterAttempt: 1}.",
        ],
        actions: [
          { label: "Run job", run: ({ jobs }) => jobs.success({ ms: 3000, label: "basic" }) },
        ],
      },
      {
        title: "Priority",
        proves: "Jobs with a higher priority start first.",
        steps: ["Press Add 3 jobs.", "Open Events."],
        expect: [
          "Events lists the newest first, so read upward: started high, then mid, then low.",
          "The payload label shows which job it is.",
        ],
        actions: [
          {
            label: "Add 3 jobs",
            run: ({ queue, jobs }) => {
              queue.stop();
              jobs.success({ ms: 1500, label: "low" }, { priority: -5 });
              jobs.success({ ms: 1500, label: "mid" }, { priority: 0 });
              jobs.success({ ms: 1500, label: "high" }, { priority: 10 });
              queue.start();
            },
          },
        ],
      },
    ],
  },
  {
    title: "Retries and failures",
    tests: [
      {
        title: "Retry with backoff",
        proves: "A failing job is retried, with a growing wait between attempts.",
        steps: ["Press Fail twice.", "Open Events and watch for about 5 seconds."],
        expect: [
          "retry (Server error, attempt 1), about 1 s pause, retry again, about 2 s pause.",
          "Then completed with result recovered on attempt 3.",
        ],
        actions: [{ label: "Fail twice", run: ({ jobs }) => jobs.flaky({ failUntil: 2 }) }],
      },
      {
        title: "Gives up after max attempts",
        proves: "After maxAttempts the job is kept as failed so you can retry it.",
        steps: ["Press Always fail.", "Wait 3 seconds, open Queue.", "Press Retry on the card."],
        expect: [
          "The card shows failed, attempts 2/2 and the error HTTP 500.",
          "After Retry it runs again and ends failed again.",
        ],
        actions: [
          {
            label: "Always fail",
            run: ({ jobs }) => jobs.alwaysFail({ code: 500 }, { maxAttempts: 2 }),
          },
        ],
      },
      {
        title: "Fatal error (no retry)",
        proves: "NonRetryableError stops retrying at once.",
        steps: ["Press Fatal error.", "Open Events."],
        expect: ["started, then failed after the first attempt. There is no retry event."],
        actions: [{ label: "Fatal error", run: ({ jobs }) => jobs.fatal({}) }],
      },
      {
        title: "Server says wait (Retry-After)",
        proves: "RetryAfterError sets the wait instead of the normal backoff.",
        steps: ["Press Rate limited.", "Open Events and watch for 6 seconds."],
        expect: [
          "retry with the error 429 Too Many Requests.",
          "The next started comes about 4 seconds later (not 1), then completed.",
        ],
        actions: [{ label: "Rate limited", run: ({ jobs }) => jobs.retryAfter({ delayMs: 4000 }) }],
      },
      {
        title: "Timeout",
        proves: "A job that never ends is stopped by its timeoutMs.",
        steps: ["Press Hang (2 s timeout).", "Open Events and watch for 5 seconds."],
        expect: ["After 2 seconds: retry with the error Job timed out after 2000ms, then failed."],
        actions: [
          {
            label: "Hang (2 s timeout)",
            run: ({ jobs }) => jobs.hang({}, { timeoutMs: 2000, maxAttempts: 2 }),
          },
        ],
      },
    ],
  },
  {
    title: "Control",
    tests: [
      {
        title: "Cancel a running job",
        proves: "Removing a running job fires its AbortSignal.",
        steps: [
          "Press Start long job.",
          "Open Queue: it is active.",
          "Press Remove on it.",
          "Open Events.",
        ],
        expect: ["Events shows removed. The job is gone and never completes."],
        actions: [
          { label: "Start long job", run: ({ jobs }) => jobs.hang({}, { timeoutMs: 10 * 60_000 }) },
        ],
      },
      {
        title: "Delay",
        proves: "delayMs keeps a job pending until it is due.",
        steps: ["Press Run in 5 s.", "Open Queue right away."],
        expect: ["The card is pending with due in 5s counting down, then it runs."],
        actions: [
          {
            label: "Run in 5 s",
            run: ({ jobs }) => jobs.success({ ms: 1000, label: "delay" }, { delayMs: 5000 }),
          },
        ],
      },
      {
        title: "Expiry",
        proves: "ttlMs drops a job that has not started in time.",
        steps: ["Press Expire first.", "Open Queue, then wait 5 seconds.", "Open Events."],
        expect: [
          "The card shows expires in 4s and due in 6s.",
          "After 4 seconds it disappears. Events shows expired and no started.",
        ],
        actions: [
          {
            label: "Expire first",
            run: ({ jobs }) =>
              jobs.success({ ms: 1000, label: "ttl" }, { delayMs: 6000, ttlMs: 4000 }),
          },
        ],
      },
      {
        title: "Dedupe",
        proves: "The same dedupeKey never creates two jobs.",
        steps: ["Press Enqueue 3 times.", "Open Queue."],
        expect: ["A message says 3 calls created 1 job, and Queue shows a single job."],
        actions: [
          {
            label: "Enqueue 3 times",
            run: ({ jobs }) => {
              const ids = new Set<string>();
              for (let i = 0; i < 3; i++) {
                ids.add(jobs.success({ ms: 4000, label: "dedupe" }, { dedupeKey: "sync" }).id);
              }
              notify(`3 calls created ${ids.size} job`, "ok");
            },
          },
        ],
      },
      {
        title: "Keep order (orderKey)",
        proves: "Jobs sharing an orderKey run one after another, even when one fails.",
        steps: [
          "Press With orderKey, open Events and wait 6 seconds.",
          "Press Without and compare.",
        ],
        expect: [
          "With: step 1 fails twice first. Steps 2 and 3 start only after step 1 completes.",
          "Without: steps 2 and 3 finish while step 1 is still retrying.",
        ],
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
        title: "Generator job",
        proves: "An async generator reports progress and can be cancelled between steps.",
        steps: [
          "Press 8 chunks.",
          "Open Queue: watch the bar.",
          "Run it again and press Remove halfway.",
        ],
        expect: ["The bar moves in 8 steps over about 4 seconds. After Remove it stops at once."],
        actions: [{ label: "8 chunks", run: ({ jobs }) => jobs.resumable({ chunks: 8 }) }],
      },
      {
        title: "Hand off to a native task",
        proves: "detach() keeps a job active until you complete or fail it.",
        steps: [
          "Press Hand off.",
          "Open Queue: the card is active with an external id.",
          "Press Complete (or Fail).",
        ],
        expect: [
          "Complete: the job disappears and Events shows completed.",
          "Fail: the job is retried like any failure.",
        ],
        actions: [{ label: "Hand off", run: ({ jobs }) => jobs.native({ file: "video.mp4" }) }],
      },
    ],
  },
  {
    title: "Network",
    tests: [
      {
        title: "Offline: wait or run",
        proves: "requiresNetwork decides whether a job waits for a connection.",
        steps: ["Press 1 Go offline.", "Press 2, then 3. Open Queue.", "Press 4 Go online."],
        expect: [
          "Job 2 stays pending. Job 3 (works offline) runs and completes.",
          "After step 4 job 2 runs. You can also turn the Mac's Wi-Fi off for real.",
        ],
        actions: [
          { label: "1 Go offline", kind: "ghost", run: () => setForcedOffline(true) },
          {
            label: "2 Needs network",
            run: ({ jobs }) => jobs.success({ ms: 1500, label: "needs network" }),
          },
          {
            label: "3 Works offline",
            run: ({ jobs }) =>
              jobs.success({ ms: 1500, label: "works offline" }, { requiresNetwork: false }),
          },
          { label: "4 Go online", kind: "ghost", run: () => setForcedOffline(false) },
        ],
      },
      {
        title: "Connection drops mid-request",
        proves: "A drop while a request runs does not use up an attempt.",
        steps: [
          "Press 1 Start request (takes 6 s).",
          "Press 2 Go offline within 6 seconds.",
          "Wait, then press 3 Go online.",
        ],
        expect: [
          "Events shows requeued (not retry) and attempts used stays 0.",
          "After step 3 the request runs again and completes.",
        ],
        actions: [
          { label: "1 Start request", run: ({ jobs }) => jobs.fetch({ ms: 6000 }) },
          { label: "2 Go offline", kind: "ghost", run: () => setForcedOffline(true) },
          { label: "3 Go online", kind: "ghost", run: () => setForcedOffline(false) },
        ],
      },
    ],
  },
  {
    title: "Limits and safety",
    tests: [
      {
        title: "Per-type limits",
        proves: "A job type can be limited to N at once and M starts per time window.",
        steps: ["Press Burst of 8.", "Open Queue and watch for 10 seconds."],
        expect: [
          "Never more than 1 job active (limit: concurrency 1).",
          "After the 3rd start, the 4th waits until 6 seconds after the 1st (limit: 3 per 6 s).",
        ],
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
        title: "Sensitive payload",
        proves: "sensitive: true hides the payload and result from listeners.",
        steps: [
          "Press Sensitive, then Normal.",
          "Open Events.",
          "Open Queue and press Details on one.",
        ],
        expect: [
          "Events: the sensitive job shows (hidden); the normal one shows the pin.",
          "Details still shows the pin in storage: sensitive does not encrypt anything.",
        ],
        actions: [
          {
            label: "Sensitive",
            run: ({ jobs }) => jobs.sensitive({ pin: "1234" }, { sensitive: true }),
          },
          { label: "Normal", kind: "ghost", run: ({ jobs }) => jobs.sensitive({ pin: "1234" }) },
        ],
      },
      {
        title: "Payload too large",
        proves: "maxPayloadBytes rejects big payloads before anything is saved.",
        steps: ["Press Enqueue too large."],
        expect: ["A red message says the payload is over maxPayloadBytes. Queue stays empty."],
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
        title: "Secret in a payload",
        proves: "A payload key like token logs a one-time warning in development.",
        steps: ["Press apiToken in payload.", "Look at the Metro terminal."],
        expect: [
          "Metro prints [queuekit] ... secret-looking key apiToken. It prints once per job type.",
        ],
        actions: [
          {
            label: "apiToken in payload",
            run: ({ queue }) => queue.enqueue("demo.success", { ms: 500, apiToken: "abc123" }),
          },
        ],
      },
      {
        title: "Defining a job twice (strict)",
        proves: "Re-defining a type with another handler is an error while strict is on.",
        steps: [
          "Press 1 Define again.",
          "Press 2 Strict off, then 1 again.",
          "Press 3 Strict on to restore.",
        ],
        expect: [
          "Strict on: a red message says it is already defined with a different handler.",
          "Strict off: a message says it was replaced silently.",
        ],
        actions: [
          {
            label: "1 Define again",
            kind: "danger",
            run: ({ queue }) =>
              attempt(() => redefineSuccess(queue), "Replaced silently (strict is off)"),
          },
          { label: "2 Strict off", kind: "ghost", run: withSettings({ strict: false }) },
          { label: "3 Strict on", kind: "ghost", run: withSettings({ strict: true }) },
        ],
      },
    ],
  },
  {
    title: "Persistence",
    tests: [
      {
        title: "Payload migration",
        proves: "Jobs saved by an older app version are upgraded when the queue loads.",
        steps: ["Press Write old job and restart.", "Open Queue."],
        expect: ["demo.profile has the payload {name: Ada Lovelace} and a v2 tag, not fullName."],
        actions: [
          {
            label: "Write old job and restart",
            run: ({ storage }) => {
              const id = `old-${Date.now()}`;
              storage.set(
                `queuekit:${QUEUE_NAME}:job:${id}`,
                JSON.stringify(OLD_PROFILE_JOB(id, "Ada Lovelace")),
              );
              rebuildRuntime();
            },
          },
        ],
      },
      {
        title: "Crash recovery",
        proves: "A job that was running when the app died runs again on the next start.",
        steps: [
          "Press 1 Start long job.",
          "Press 2 Restart queue (a simulated crash). For the real thing, force-quit the app and reopen it.",
          "Open Queue and Events.",
        ],
        expect: [
          "The job is back, the attempt count is unchanged, and Events shows a second started.",
        ],
        actions: [
          {
            label: "1 Start long job",
            run: ({ jobs }) => jobs.hang({}, { timeoutMs: 10 * 60_000 }),
          },
          { label: "2 Restart queue", kind: "ghost", run: () => rebuildRuntime() },
        ],
      },
      {
        title: "Clean up failed jobs",
        proves: "retention deletes old failed jobs so they do not pile up.",
        steps: [
          "Press 1 Keep 2 failed.",
          "Press 2 Add 5 failures.",
          "Open Events and Queue.",
          "Press 3 when done.",
        ],
        expect: ["Events shows removed 3 times (the oldest). Queue keeps 2 failed jobs."],
        actions: [
          {
            label: "1 Keep 2 failed",
            kind: "ghost",
            run: withSettings({ retentionEnabled: true, maxFailed: 2, failedTtlMs: 0 }),
          },
          {
            label: "2 Add 5 failures",
            run: ({ jobs }) => {
              for (let i = 0; i < 5; i++) jobs.fatal({});
            },
          },
          {
            label: "3 Retention off",
            kind: "ghost",
            run: withSettings({ retentionEnabled: false }),
          },
        ],
      },
    ],
  },
  {
    title: "Several instances",
    tests: [
      {
        title: "Leader election (lease)",
        proves: "Instances sharing one storage elect one leader; another takes over if it stops.",
        steps: [
          "Press 1 Lease on, then 2 Add instance B.",
          "Open Dashboard: A is leader, B is follower.",
          "Press 3 Stop A and wait 4 seconds.",
          "Press 4 Run a job and open Events.",
        ],
        expect: [
          "Dashboard: B becomes the leader.",
          "Events: the job is started by instance B (the letter shows next to the time).",
        ],
        actions: [
          { label: "1 Lease on", kind: "ghost", run: withSettings({ lease: true }) },
          { label: "2 Add instance B", kind: "ghost", run: () => spawnFollower() },
          { label: "3 Stop A", kind: "ghost", run: ({ queue }) => queue.stop() },
          { label: "4 Run a job", run: ({ jobs }) => jobs.success({ ms: 1500, label: "lease" }) },
          { label: "Lease off", kind: "ghost", run: withSettings({ lease: false }) },
        ],
      },
    ],
  },
];

const PRESETS: Record<string, string> = {
  "demo.success": '{ "ms": 2000 }',
  "demo.fetch": '{ "ms": 2000 }',
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

function TestCard({
  test,
  open,
  onToggle,
  runtime,
  go,
}: Readonly<{
  test: Test;
  open: boolean;
  onToggle: () => void;
  runtime: Runtime;
  go: (tab: string) => void;
}>) {
  return (
    <Card>
      <Pressable onPress={onToggle} style={{ gap: 2 }}>
        <Row>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 }}>
            {test.title}
          </Text>
          <Text style={{ color: colors.accent, fontSize: 18, fontWeight: "700" }}>
            {open ? "-" : "+"}
          </Text>
        </Row>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{test.proves}</Text>
      </Pressable>
      {open ? (
        <View style={{ gap: 10 }}>
          <View style={{ gap: 3 }}>
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "700" }}>
              HOW TO TEST
            </Text>
            {test.steps.map((step, i) => (
              <Text key={step} style={{ color: colors.text, fontSize: 13 }}>
                {i + 1}. {step}
              </Text>
            ))}
          </View>
          <View style={{ gap: 3 }}>
            <Text style={{ color: colors.ok, fontSize: 12, fontWeight: "700" }}>
              YOU SHOULD SEE
            </Text>
            {test.expect.map((line) => (
              <Text key={line} style={{ color: colors.text, fontSize: 13 }}>
                - {line}
              </Text>
            ))}
          </View>
          <Row wrap>
            {test.actions.map((action) => (
              <Btn
                key={action.label}
                label={action.label}
                kind={action.kind ?? "primary"}
                small
                onPress={() => attempt(() => action.run(runtime))}
              />
            ))}
          </Row>
          <Row wrap>
            <Btn label="Open Queue" small kind="ghost" onPress={() => go("queue")} />
            <Btn label="Open Events" small kind="ghost" onPress={() => go("events")} />
            <Btn label="Open Dashboard" small kind="ghost" onPress={() => go("dashboard")} />
          </Row>
        </View>
      ) : null}
    </Card>
  );
}

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
    <View style={{ gap: 10 }}>
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
    </View>
  );
}

export function LabScreen({ go }: Readonly<{ go: (tab: string) => void }>) {
  const runtime = useRuntime();
  const [open, setOpen] = useState<string | undefined>();
  const [custom, setCustom] = useState(false);

  const reset = () => {
    setForcedOffline(false);
    runtime.queue.clear();
    runtime.storage.clearAll();
    clearLog();
    rebuildRuntime(DEFAULT_SETTINGS);
    notify("Clean slate: jobs, log and settings reset", "ok");
  };

  return (
    <Screen>
      <Heading>Lab</Heading>
      <Card title="How to use this tab">
        <Body>
          1. Tap a test to open it. 2. Press its buttons in order. 3. Open Queue or Events and
          compare with "You should see".
        </Body>
        <Body muted>Start each test from a clean slate. Events lists the newest first.</Body>
        <Btn label="Reset everything" small kind="danger" onPress={reset} />
      </Card>

      {SECTIONS.map((section) => (
        <View key={section.title} style={{ gap: 10 }}>
          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "800", marginTop: 6 }}>
            {section.title.toUpperCase()}
          </Text>
          {section.tests.map((test) => (
            <TestCard
              key={test.title}
              test={test}
              open={open === test.title}
              onToggle={() => setOpen(open === test.title ? undefined : test.title)}
              runtime={runtime}
              go={go}
            />
          ))}
        </View>
      ))}

      <Card
        title="Advanced: build your own job"
        hint="Any enqueue() call by hand. 0 or empty means not set."
        right={
          <Btn
            label={custom ? "Hide" : "Show"}
            small
            kind="ghost"
            onPress={() => setCustom(!custom)}
          />
        }
      >
        {custom ? <CustomJob runtime={runtime} /> : null}
      </Card>
    </Screen>
  );
}
