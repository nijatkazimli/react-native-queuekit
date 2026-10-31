import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueEventInfo } from "../../src/index.js";
import { createQueue, memoryStorage, NonRetryableError } from "../../src/index.js";

const fastRetry = { baseDelayMs: 1, maxDelayMs: 5, jitter: false };
const network = (online: boolean) => {
  let on = online;
  const listeners = new Set<(v: boolean) => void>();
  return {
    isOnline: () => on,
    subscribe: (l: (v: boolean) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(v: boolean) {
      on = v;
      for (const l of listeners) l(v);
    },
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("orderKey", () => {
  it("runs same-key jobs one at a time in enqueue order, others in parallel", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: {
        t: async (payload) => {
          log.push(`start ${payload}`);
          await new Promise((r) => setTimeout(r, 10));
          log.push(`end ${payload}`);
        },
      },
    });
    queue.enqueue("t", "a1", { orderKey: "a", priority: 0 });
    queue.enqueue("t", "a2", { orderKey: "a", priority: 9 });
    queue.enqueue("t", "b1", { orderKey: "b" });
    await vi.advanceTimersByTimeAsync(50);
    expect(log.indexOf("start a2")).toBeGreaterThan(log.indexOf("end a1"));
    expect(log.slice(0, 2)).toEqual(["start a1", "start b1"]);
    expect(log).toHaveLength(6);
    expect(queue.getJobs()).toEqual([]);
  });

  it("holds later jobs while the earlier one backs off, but not after it fails", async () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      retry: { ...fastRetry, maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 100 },
      handlers: {
        t: (payload) => {
          ran.push(String(payload));
          if (payload === "first") throw new Error("boom");
        },
      },
    });
    queue.enqueue("t", "first", { orderKey: "k" });
    queue.enqueue("t", "second", { orderKey: "k" });
    await vi.advanceTimersByTimeAsync(50);
    expect(ran).toEqual(["first"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(ran).toEqual(["first", "first", "second"]);
  });
});

describe("orderKey with expiry", () => {
  it("lets a job run once the earlier job with its key expires", async () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: { t: (payload) => void ran.push(String(payload)) },
    });
    queue.enqueue("t", "early", { orderKey: "k", delayMs: 100, ttlMs: 30 });
    queue.enqueue("t", "late", { orderKey: "k" });
    await vi.advanceTimersByTimeAsync(200);
    expect(ran).toEqual(["late"]);
  });
});

describe("per-job options", () => {
  it("applies per-job timeoutMs and retry", async () => {
    vi.useFakeTimers();
    const infos: QueueEventInfo[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      timeoutMs: 10_000,
      handlers: { slow: () => new Promise(() => {}) },
    });
    queue.observe((i) => infos.push(i));
    const job = queue.enqueue("slow", null, {
      timeoutMs: 20,
      retry: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
    });
    expect(job.maxAttempts).toBe(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(infos.map((i) => i.event)).toEqual([
      "enqueued",
      "started",
      "retry",
      "started",
      "failed",
    ]);
    expect(queue.getJobs()[0]?.failedAt).toBeDefined();
  });

  it("gives jobs enqueued in the same millisecond distinct, increasing createdAt", () => {
    vi.useFakeTimers();
    const queue = createQueue({
      storage: memoryStorage(),
      autoStart: false,
      handlers: { t: () => {} },
    });
    const a = queue.enqueue("t", 1);
    const b = queue.enqueue("t", 2);
    expect(b.createdAt).toBeGreaterThan(a.createdAt);
  });
});

describe("events", () => {
  it("passes the handler result to observers of completed", async () => {
    const infos: QueueEventInfo[] = [];
    const queue = createQueue({ storage: memoryStorage(), handlers: { t: () => 42 } });
    queue.observe((i) => infos.push(i));
    queue.enqueue("t", null);
    await queue.drain();
    expect(infos.find((i) => i.event === "completed")?.result).toBe(42);
  });

  it("emits removed for remove() and clear(), and requeued when going offline mid-run", async () => {
    vi.useFakeTimers();
    const net = network(true);
    const events: string[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      network: net,
      handlers: {
        t: async () => {
          net.set(false);
          throw new Error("offline");
        },
      },
    });
    for (const e of ["removed", "requeued"] as const) queue.on(e, () => events.push(e));
    queue.enqueue("t", null);
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual(["requeued"]);
    queue.clear();
    expect(queue.remove("nope")).toBe(false);
    expect(events).toEqual(["requeued", "removed"]);
  });
});

describe("retention", () => {
  it("removes failed jobs after failedTtlMs and beyond maxFailed", async () => {
    vi.useFakeTimers();
    const removed: string[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      retention: { maxFailed: 2, failedTtlMs: 1000 },
      handlers: {
        t: () => {
          throw new NonRetryableError("no");
        },
      },
    });
    queue.on("removed", (j) => removed.push(j.id));
    for (const id of ["a", "b", "c"]) {
      queue.enqueue("t", null, { id });
      await vi.advanceTimersByTimeAsync(5);
    }
    expect(removed).toEqual(["a"]);
    expect(queue.getStats().failed).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(removed).toEqual(["a", "b", "c"]);
    expect(queue.getStats().total).toBe(0);
  });

  it("retry() clears failedAt", async () => {
    vi.useFakeTimers();
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: {
        t: () => {
          throw new NonRetryableError("no");
        },
      },
    });
    const { id } = queue.enqueue("t", null);
    await vi.advanceTimersByTimeAsync(5);
    queue.stop();
    queue.retry(id);
    expect(queue.getJobs()[0]?.failedAt).toBeUndefined();
  });
});

describe("stored jobs", () => {
  const stored = (id: string, extra: object) => ({
    id,
    type: "t",
    payload: null,
    status: "pending",
    priority: 0,
    attempts: 0,
    maxAttempts: 3,
    runAt: 0,
    requiresNetwork: false,
    ...extra,
  });

  it("orders by createdAt even when loaded newest first", async () => {
    const storage = memoryStorage();
    storage.set(
      "queuekit:default:job:new",
      JSON.stringify(stored("new", { createdAt: 2, orderKey: "k" })),
    );
    storage.set(
      "queuekit:default:job:old",
      JSON.stringify(stored("old", { createdAt: 1, orderKey: "k" })),
    );
    const ran: string[] = [];
    const queue = createQueue({ storage, handlers: { t: (_p, ctx) => void ran.push(ctx.job.id) } });
    await queue.drain();
    expect(ran).toEqual(["old", "new"]);
  });

  it("applies each retention limit on its own, using createdAt for old failures", () => {
    const storage = memoryStorage();
    for (const id of ["a", "b"])
      storage.set(
        `queuekit:default:job:${id}`,
        JSON.stringify(stored(id, { status: "failed", createdAt: id === "a" ? 1 : 2 })),
      );
    const onlyTtl = createQueue({
      storage,
      autoStart: false,
      handlers: {},
      retention: { failedTtlMs: 1e15 },
    });
    onlyTtl.start();
    expect(onlyTtl.getStats().failed).toBe(2);
    onlyTtl.dispose();
    const onlyMax = createQueue({
      storage,
      autoStart: false,
      handlers: {},
      retention: { maxFailed: 1 },
    });
    onlyMax.start();
    expect(onlyMax.getJobs().map((j) => j.id)).toEqual(["b"]);
  });
});
