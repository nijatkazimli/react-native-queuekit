import fc from "fast-check";
import { afterEach, describe, it, vi } from "vitest";
import type { Job, JobContext, NetworkMonitor, Queue, QueueStorage } from "../../src/index.js";
import { createQueue, memoryStorage, NonRetryableError } from "../../src/index.js";

const PREFIX = "queuekit:default:job:";
const CONCURRENCY = 2;
declare const process: { env: Record<string, string | undefined> };
const RUNS = Number(process.env.FC_RUNS) || 150;
const SEED = Number(process.env.FC_SEED) || 20261031;

type Outcome = "ok" | "fail" | "fatal";
type EnqueueOp = {
  kind: "enqueue" | "enqueueOther";
  type: "a" | "b";
  net: boolean;
  priority: number;
  maxAttempts: number;
  delayMs: number;
  ttlMs: number | undefined;
  orderKey: "k1" | "k2" | undefined;
};
type Op =
  | EnqueueOp
  | { kind: "settle"; pick: number; outcome: Outcome }
  | { kind: "advance"; ms: number }
  | { kind: "network"; online: boolean }
  | { kind: "stop" | "start" | "flush" | "crash" }
  // Only meaningful with a lease: a second instance sharing the same storage.
  | { kind: "spawn" | "stopOther" | "startOther" | "killOther" }
  | { kind: "remove" | "retry"; pick: number };

const enqueueArb = (kind: EnqueueOp["kind"]) =>
  fc.record({
    kind: fc.constant(kind),
    type: fc.constantFrom("a" as const, "b" as const),
    net: fc.boolean(),
    priority: fc.integer({ min: -2, max: 2 }),
    maxAttempts: fc.integer({ min: 1, max: 3 }),
    delayMs: fc.constantFrom(0, 0, 20, 100),
    ttlMs: fc.option(fc.constantFrom(30, 300), { nil: undefined }),
    orderKey: fc.option(fc.constantFrom("k1" as const, "k2" as const), { nil: undefined }),
  });

const simple = <
  K extends
    | "stop"
    | "start"
    | "flush"
    | "crash"
    | "spawn"
    | "stopOther"
    | "startOther"
    | "killOther",
>(
  kind: K,
) => fc.constant({ kind });

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: enqueueArb("enqueue") },
  { weight: 3, arbitrary: enqueueArb("enqueueOther") },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("settle" as const),
      pick: fc.nat(),
      outcome: fc.constantFrom<Outcome>("ok", "ok", "fail", "fatal"),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant("advance" as const),
      ms: fc.constantFrom(0, 1, 5, 20, 100, 1500),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant("network" as const), online: fc.boolean() }),
  },
  { weight: 1, arbitrary: simple("stop") },
  { weight: 1, arbitrary: simple("start") },
  { weight: 1, arbitrary: simple("flush") },
  { weight: 2, arbitrary: simple("crash") },
  { weight: 2, arbitrary: simple("spawn") },
  { weight: 1, arbitrary: simple("stopOther") },
  { weight: 1, arbitrary: simple("startOther") },
  { weight: 1, arbitrary: simple("killOther") },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("remove" as const), pick: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("retry" as const), pick: fc.nat() }) },
);

function cloneStorage(source: QueueStorage): QueueStorage {
  const copy = memoryStorage();
  for (const key of source.getAllKeys()) {
    const value = source.getString(key);
    if (value !== undefined) copy.set(key, value);
  }
  return copy;
}

function readStored(storage: QueueStorage): Map<string, Job> {
  const stored = new Map<string, Job>();
  for (const key of storage.getAllKeys()) {
    if (!key.startsWith(PREFIX)) continue;
    stored.set(key.slice(PREFIX.length), JSON.parse(storage.getString(key) ?? "null") as Job);
  }
  return stored;
}

type Call = {
  jobId: string;
  signal: AbortSignal;
  settled: boolean;
  settle(outcome: Outcome): void;
};
type Instance = { queue: Queue; started: boolean };

/**
 * Drives one queue (or, with `leased`, up to two instances sharing a storage) with a random
 * operation sequence and checks invariants after every step.
 */
async function run(ops: Op[], leased: boolean) {
  vi.useFakeTimers();
  vi.setSystemTime(0);

  let storage = memoryStorage();
  let auto = false;
  let online = true;
  let instances: Instance[] = [];
  const listeners = new Set<(online: boolean) => void>();
  const network: NetworkMonitor = {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const calls: Call[] = [];
  const violations: string[] = [];
  const expected = new Set<string>(); // jobs that must still exist
  const everSeen = new Set<string>();
  const runningKey = new Map<string, string>();

  const handler = (_: unknown, ctx: JobContext) =>
    new Promise<void>((resolve, reject) => {
      const overlapping = calls.some(
        (c) => c.jobId === ctx.job.id && !c.settled && !c.signal.aborted,
      );
      if (overlapping) violations.push(`job ${ctx.job.id} ran twice at once`);
      const key = ctx.job.orderKey;
      if (key !== undefined) {
        const earlier = [...readStored(storage).values()].filter(
          (j) =>
            j.orderKey === key &&
            j.id !== ctx.job.id &&
            j.status !== "failed" &&
            j.createdAt < ctx.job.createdAt,
        );
        if (earlier.length) violations.push(`${ctx.job.id} started before ${earlier[0]?.id}`);
        const sameKeyRunning = calls.some(
          (c) =>
            c.jobId !== ctx.job.id &&
            !c.settled &&
            !c.signal.aborted &&
            runningKey.get(c.jobId) === key,
        );
        if (sameKeyRunning) violations.push(`two jobs with orderKey ${key} ran at once`);
        runningKey.set(ctx.job.id, key);
      }
      const call: Call = {
        jobId: ctx.job.id,
        signal: ctx.signal,
        settled: false,
        settle(outcome) {
          if (call.settled) return;
          call.settled = true;
          if (outcome === "ok") resolve();
          else reject(outcome === "fatal" ? new NonRetryableError("fatal") : new Error("fail"));
        },
      };
      calls.push(call);
      if (auto) call.settle("ok");
    });

  function spawn(): Instance {
    const queue = createQueue({
      storage,
      network,
      concurrency: CONCURRENCY,
      timeoutMs: 1000,
      retry: { baseDelayMs: 5, maxDelayMs: 20, jitter: false, maxAttempts: 3 },
      handlers: { a: handler, b: handler },
      lease: leased ? { ttlMs: 300 } : false,
      autoStart: false, // so the listeners below also see jobs that expire while loading
    });
    queue.on("completed", (job) => expected.delete(job.id));
    queue.on("expired", (job) => expected.delete(job.id));
    queue.start();
    const instance = { queue, started: true };
    instances.push(instance);
    return instance;
  }

  const primary = () => {
    const first = instances[0];
    if (!first) throw new Error("no instance");
    return first;
  };
  const leaderQueue = () => instances.find((i) => i.queue.isLeader())?.queue;

  function check() {
    const stored = readStored(storage);

    for (const { queue } of instances) {
      const jobs = queue.getJobs();
      if (!leased || queue.isLeader()) {
        const ids = jobs.map((j) => j.id);
        const missing = ids.filter((id) => !stored.has(id));
        if (missing.length) throw new Error(`in memory but not stored: ${missing}`);
        if (!leased && stored.size !== ids.length) {
          throw new Error(`storage and memory disagree: ${[...stored.keys()]} vs ${ids}`);
        }
        for (const job of jobs) {
          const saved = stored.get(job.id)?.status;
          // After a restart, memory shows an interrupted job as pending until its next write.
          const same = saved === job.status || (saved === "active" && job.status === "pending");
          if (!same) throw new Error(`status mismatch for ${job.id}: ${saved} vs ${job.status}`);
        }
      }
      for (const job of jobs) {
        if (job.attempts > job.maxAttempts) throw new Error(`too many attempts for ${job.id}`);
        if (!everSeen.has(job.id)) throw new Error(`unknown job ${job.id}`);
      }
      const count = (status: Job["status"]) => jobs.filter((j) => j.status === status).length;
      const stats = queue.getStats();
      if (
        stats.pending !== count("pending") ||
        stats.active !== count("active") ||
        stats.failed !== count("failed") ||
        stats.total !== jobs.length
      ) {
        throw new Error(`stats disagree: ${JSON.stringify(stats)}`);
      }
      if (count("active") > CONCURRENCY) throw new Error("concurrency exceeded");
    }
    for (const id of expected) {
      if (!stored.has(id)) throw new Error(`lost job ${id}`);
    }
    if (violations.length) throw new Error(violations.join("; "));
  }

  function enqueue(queue: Queue, op: EnqueueOp) {
    const job = queue.enqueue(
      op.type,
      {},
      {
        requiresNetwork: op.net,
        priority: op.priority,
        maxAttempts: op.maxAttempts,
        delayMs: op.delayMs,
        ttlMs: op.ttlMs,
        // With a lease, a follower's job is invisible to the leader until its next heartbeat.
        orderKey: leased ? undefined : op.orderKey,
      },
    );
    expected.add(job.id);
    everSeen.add(job.id);
  }

  async function apply(op: Op) {
    const first = primary();
    const second = instances[1];
    switch (op.kind) {
      case "enqueue":
        enqueue(first.queue, op);
        break;
      case "enqueueOther":
        if (second) enqueue(second.queue, op);
        break;
      case "settle": {
        const open = calls.filter((c) => !c.settled);
        open[op.pick % (open.length || 1)]?.settle(op.outcome);
        break;
      }
      case "advance":
        await vi.advanceTimersByTimeAsync(op.ms);
        break;
      case "network":
        online = op.online;
        for (const listener of listeners) listener(op.online);
        break;
      case "stop":
        first.queue.stop();
        first.started = false;
        break;
      case "start":
        first.queue.start();
        first.started = true;
        break;
      case "flush":
        first.queue.flush();
        break;
      case "spawn":
        if (leased && !second) spawn();
        break;
      case "stopOther":
        if (second) {
          second.queue.stop();
          second.started = false;
        }
        break;
      case "startOther":
        if (second) {
          second.queue.start();
          second.started = true;
        }
        break;
      case "killOther": {
        // A graceful shutdown: only when it has nothing running, so no call is left dangling.
        const busy = second && calls.some((c) => !c.settled && !c.signal.aborted);
        if (second && !busy) {
          second.queue.dispose();
          instances = [first];
        }
        break;
      }
      case "remove":
      case "retry": {
        const queue = leaderQueue();
        const jobs = queue?.getJobs() ?? [];
        const job = jobs[op.pick % (jobs.length || 1)];
        if (!queue || !job) break;
        if (op.kind === "retry") queue.retry(job.id);
        else if (queue.remove(job.id)) expected.delete(job.id);
        break;
      }
      case "crash": {
        // The new process sees exactly what was on disk; every old process is abandoned.
        const snapshot = cloneStorage(storage);
        for (const { queue } of instances) queue.dispose();
        for (const call of calls) call.settled = true;
        storage = snapshot;
        instances = [];
        spawn();
        break;
      }
    }
  }

  try {
    spawn();
    for (const op of ops) {
      await apply(op);
      await vi.advanceTimersByTimeAsync(0);
      check();
    }

    // Liveness: with a healthy network and handlers that succeed, everything not failed finishes.
    auto = true;
    for (const call of calls) call.settle("ok");
    online = true;
    for (const listener of listeners) listener(true);
    for (const instance of instances) if (!instance.started) instance.queue.start();
    for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(500);
    const left = [...readStored(storage).values()].filter((job) => job.status !== "failed");
    if (left.length) throw new Error(`jobs never finished: ${JSON.stringify(left)}`);
    check();
  } finally {
    for (const { queue } of instances) queue.dispose();
    vi.useRealTimers();
  }
}

describe("queue invariants under random operations and crashes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never loses, invents, duplicates or strands a job", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 40 }), (ops) => run(ops, false)),
      { numRuns: RUNS, seed: SEED },
    );
  }, 120_000);

  it("holds with two instances sharing one storage and a lease", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 50 }), (ops) => run(ops, true)),
      { numRuns: RUNS, seed: SEED },
    );
  }, 120_000);
});
