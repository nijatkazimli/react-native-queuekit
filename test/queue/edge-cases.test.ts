import { describe, expect, it, vi } from "vitest";
import type { JobContext, NetworkMonitor } from "../../src/index.js";
import { createQueue, memoryStorage, NonRetryableError } from "../../src/index.js";

const fastRetry = { baseDelayMs: 1, maxDelayMs: 5, jitter: false };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeNetwork(initial = true) {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();
  const monitor: NetworkMonitor & { set(value: boolean): void; size(): number } = {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      online = value;
      for (const listener of listeners) listener(value);
    },
    size: () => listeners.size,
  };
  return monitor;
}

describe("loading persisted state", () => {
  it("ignores foreign keys, empty values and corrupt entries, and keeps failed jobs", () => {
    const storage = memoryStorage();
    storage.set("other:key", "x");
    storage.set("queuekit:default:job:empty", "");
    storage.set("queuekit:default:job:bad", "{nope");
    storage.set(
      "queuekit:default:job:f1",
      JSON.stringify({ id: "f1", type: "a", status: "failed", createdAt: 1 }),
    );

    const queue = createQueue({ storage, autoStart: false });

    expect(queue.getJobs().map((job) => [job.id, job.status])).toEqual([["f1", "failed"]]);
    expect(storage.getString("queuekit:default:job:bad")).toBeUndefined();
    expect(storage.getString("other:key")).toBe("x");
  });

  it("namespaces jobs by queue name", () => {
    const storage = memoryStorage();
    const a = createQueue({ storage, name: "a", autoStart: false });
    const b = createQueue({ storage, name: "b", autoStart: false });

    a.enqueue("x", 1);

    expect(a.getStats().total).toBe(1);
    expect(b.getStats().total).toBe(0);
  });
});

describe("events", () => {
  it("emits the full lifecycle and passes errors", async () => {
    const events: string[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      retry: { ...fastRetry, maxAttempts: 2 },
      handlers: {
        ok: () => {},
        bad: () => {
          throw "plain string";
        },
      },
    });
    for (const event of ["enqueued", "started", "completed", "retry", "failed"] as const) {
      queue.on(event, (job, error) => events.push(`${event}:${job.type}${error ? ":err" : ""}`));
    }

    queue.enqueue("ok", null);
    queue.enqueue("bad", null);

    await vi.waitFor(() => expect(queue.getStats().failed).toBe(1));
    expect(events).toEqual(
      expect.arrayContaining([
        "enqueued:ok",
        "started:ok",
        "completed:ok",
        "enqueued:bad",
        "started:bad",
        "retry:bad:err",
        "failed:bad:err",
      ]),
    );
    expect(queue.getJobs()[0]!.lastError).toBe("plain string");
  });

  it("supports several listeners per event, unsubscribing, and survives a throwing listener", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });
    const first = vi.fn();
    const second = vi.fn();
    queue.on("enqueued", () => {
      throw new Error("listener bug");
    });
    queue.on("enqueued", first);
    const off = queue.on("enqueued", second);
    off();

    expect(() => queue.enqueue("a", 1)).not.toThrow();

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });
});

describe("scheduling", () => {
  it("wakes up for delayed jobs and reschedules its timer", async () => {
    const handler = vi.fn();
    const queue = createQueue({ storage: memoryStorage(), handlers: { a: handler } });

    queue.enqueue("a", 1, { delayMs: 20 });
    queue.enqueue("a", 2, { delayMs: 40 });

    expect(handler).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  });

  it("keeps jobs without a handler pending until one is registered", async () => {
    const handler = vi.fn();
    const queue = createQueue({ storage: memoryStorage() });

    queue.enqueue("late", 1);
    await sleep(10);
    expect(queue.getStats().pending).toBe(1);

    queue.register("late", handler);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  });

  it("orders equal-priority jobs by schedule time and creation order", async () => {
    const order: number[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      autoStart: false,
      concurrency: 1,
      handlers: { a: (n: unknown) => void order.push(n as number) },
    });

    queue.enqueue("a", 1);
    queue.enqueue("a", 2);
    queue.enqueue("a", 3);
    await sleep(3);
    queue.enqueue("a", 4);
    queue.start();

    await vi.waitFor(() => expect(order).toEqual([1, 2, 3, 4]));
  });

  it("stop() halts processing and clears timers, and start()/stop() are idempotent", async () => {
    const handler = vi.fn();
    const network = fakeNetwork();
    const queue = createQueue({
      storage: memoryStorage(),
      network,
      autoStart: false,
      handlers: { a: handler },
    });

    queue.stop();
    queue.start();
    queue.start();
    expect(network.size()).toBe(1);

    queue.enqueue("a", 1, { delayMs: 30 });
    queue.stop();
    queue.stop();
    expect(network.size()).toBe(0);

    await sleep(50);
    expect(handler).not.toHaveBeenCalled();

    queue.start();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  });

  it("runs local-only jobs offline and retries their failures with backoff", async () => {
    const network = fakeNetwork(false);
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk busy"))
      .mockResolvedValue(undefined);
    const queue = createQueue({
      storage: memoryStorage(),
      network,
      retry: fastRetry,
      handlers: { local: handler },
    });

    queue.enqueue("local", null, { requiresNetwork: false });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(queue.getStats().total).toBe(0));
  });
});

describe("enqueue", () => {
  it("returns the existing job for a repeated id", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });

    const first = queue.enqueue("a", 1, { id: "fixed" });

    expect(queue.enqueue("a", 2, { id: "fixed" })).toEqual(first);
    expect(queue.getStats().total).toBe(1);
  });

  it("allows a new job with the same dedupeKey once the old one has failed", async () => {
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: {
        a: () => {
          throw new NonRetryableError("nope");
        },
      },
    });

    const first = queue.enqueue("a", 1, { dedupeKey: "k" });
    await vi.waitFor(() => expect(queue.getStats().failed).toBe(1));
    const second = queue.enqueue("a", 2, { dedupeKey: "k" });

    expect(second.id).not.toBe(first.id);
  });

  it("applies per-job options", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });

    const job = queue.enqueue("a", 1, { maxAttempts: 9, requiresNetwork: false, delayMs: 1000 });

    expect(job.maxAttempts).toBe(9);
    expect(job.requiresNetwork).toBe(false);
    expect(job.runAt).toBeGreaterThanOrEqual(job.createdAt + 1000);
  });
});

describe("inspection and control", () => {
  it("filters jobs and caches stats until something changes", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });
    queue.enqueue("a", 1);
    queue.enqueue("b", 2);

    expect(queue.getJobs()).toBe(queue.getJobs());
    expect(queue.getJobs({ status: "pending" })).toHaveLength(2);
    expect(queue.getJobs({ status: "failed" })).toHaveLength(0);
    expect(queue.getJobs({ type: "a" })).toHaveLength(1);
    expect(queue.getJobs({ status: "pending", type: "b" })).toHaveLength(1);

    const stats = queue.getStats();
    expect(queue.getStats()).toBe(stats);
    queue.enqueue("c", 3);
    expect(queue.getStats()).not.toBe(stats);
    expect(queue.getStats()).toEqual({ pending: 3, active: 0, failed: 0, total: 3 });
  });

  it("retry() and remove() report whether they found a job", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });
    const job = queue.enqueue("a", 1);

    expect(queue.retry("missing")).toBe(false);
    expect(queue.retry(job.id)).toBe(false);
    expect(queue.remove("missing")).toBe(false);
    expect(queue.remove(job.id)).toBe(true);
  });

  it("clear() removes every job", () => {
    const storage = memoryStorage();
    const queue = createQueue({ storage, autoStart: false });
    queue.enqueue("a", 1);
    queue.enqueue("b", 2);

    queue.clear();

    expect(queue.getStats().total).toBe(0);
    expect(storage.getAllKeys()).toEqual([]);
  });

  it("notifies subscribers until they unsubscribe, and dispose() drops them all", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });
    const kept = vi.fn();
    const dropped = vi.fn();
    const off = queue.subscribe(dropped);
    queue.subscribe(kept);

    off();
    queue.enqueue("a", 1);
    expect(dropped).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalled();

    kept.mockClear();
    queue.dispose();
    queue.enqueue("a", 2);
    expect(kept).not.toHaveBeenCalled();
  });
});

describe("handlers", () => {
  it("replaces a handler when a type is defined twice and strict is off", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const queue = createQueue({ storage: memoryStorage(), strict: false });
    const a = queue.define("dup", first);
    queue.define("dup", second);

    a({});

    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
  });

  it("is strict by default, except in development builds (__DEV__)", () => {
    const flag = globalThis as { __DEV__?: boolean };
    const redefine = () => {
      const queue = createQueue({ storage: memoryStorage() });
      queue.define("dup", vi.fn());
      queue.define("dup", vi.fn());
    };

    expect(redefine).toThrow(/already defined/);

    flag.__DEV__ = true;
    try {
      expect(redefine).not.toThrow();
    } finally {
      delete flag.__DEV__;
    }
  });

  it("strict mode rejects a different handler for an existing type but allows the same one", () => {
    const handler = vi.fn();
    const queue = createQueue({ storage: memoryStorage(), strict: true, handlers: {} });

    queue.define("dup", handler);

    expect(() => queue.define("dup", handler)).not.toThrow();
    expect(() => queue.define("dup", vi.fn())).toThrow(
      'Job type "dup" is already defined with a different handler',
    );
    expect(() => queue.register("dup", vi.fn())).toThrow(/already defined/);
    expect(() => queue.define("other", vi.fn())).not.toThrow();
  });

  it("treats null, plain objects and arrays returned by handlers as results, not iterators", async () => {
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: { nul: () => null, obj: () => ({}), arr: () => [1, 2], str: () => "done" },
    });

    for (const type of ["nul", "obj", "arr", "str"] as const) queue.enqueue(type, null);

    await vi.waitFor(() => expect(queue.getStats().total).toBe(0));
  });

  it("stops a running generator at its next yield once the job is removed", async () => {
    let steps = 0;
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: {
        gen: async function* () {
          for (;;) {
            steps++;
            await sleep(5);
            yield;
          }
        },
      },
    });

    const job = queue.enqueue("gen", null);
    await vi.waitFor(() => expect(steps).toBeGreaterThan(1));
    queue.remove(job.id);
    const seen = steps;
    await sleep(40);

    expect(steps).toBeLessThanOrEqual(seen + 1);
  });

  it("registers decorated methods without default options", async () => {
    const queue = createQueue({ storage: memoryStorage() });
    const calls: unknown[] = [];

    class Service {
      async run(payload: unknown, _ctx?: JobContext) {
        calls.push(payload);
      }
    }
    const initializers: (() => void)[] = [];
    queue.handler("plain")(Service.prototype.run, {
      addInitializer: (fn: () => void) => initializers.push(fn),
    } as never);
    const service = new Service();
    for (const init of initializers) init.call(service);

    expect(queue.enqueue(service.run, "x")).toMatchObject({ type: "plain", priority: 0 });
    await vi.waitFor(() => expect(calls).toEqual(["x"]));
  });
});

describe("far-future jobs", () => {
  it("never arms a timer above the 32-bit limit and still runs the job on time", async () => {
    vi.useFakeTimers();
    const DAY = 86_400_000;
    const ran: string[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: { t: (payload) => void ran.push(String(payload)) },
    });
    const spy = vi.spyOn(globalThis, "setTimeout");
    queue.enqueue("t", "later", { delayMs: 40 * DAY });
    await vi.advanceTimersByTimeAsync(30 * DAY);
    expect(ran).toEqual([]);
    await vi.advanceTimersByTimeAsync(11 * DAY);
    expect(ran).toEqual(["later"]);
    for (const call of spy.mock.calls) expect(call[1] ?? 0).toBeLessThanOrEqual(2 ** 31 - 1);
    spy.mockRestore();
    queue.dispose();
    vi.useRealTimers();
  });
});
