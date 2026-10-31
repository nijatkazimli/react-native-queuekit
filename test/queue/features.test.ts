import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, JobContext, NetworkMonitor, QueueEventInfo } from "../../src/index.js";
import { createQueue, memoryStorage, NonRetryableError, RetryAfterError } from "../../src/index.js";

const fastRetry = { baseDelayMs: 1, maxDelayMs: 5, jitter: false };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeNetwork(initial = true) {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();
  const monitor: NetworkMonitor & { set(value: boolean): void } = {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      online = value;
      for (const listener of listeners) listener(value);
    },
  };
  return monitor;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("observe()", () => {
  it("reports every event, with durations for finished attempts", async () => {
    const infos: QueueEventInfo[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      retry: { ...fastRetry, maxAttempts: 2 },
      handlers: {
        ok: () => sleep(5),
        bad: () => {
          throw new Error("x");
        },
      },
    });
    queue.observe((info) => infos.push(info));

    queue.enqueue("ok", null);
    queue.enqueue("bad", null);
    await vi.waitFor(() => expect(queue.getStats().failed).toBe(1));

    const find = (event: string, type: string) =>
      infos.find((i) => i.event === event && i.job.type === type)!;
    expect(find("enqueued", "ok").durationMs).toBeUndefined();
    expect(find("started", "ok").durationMs).toBeUndefined();
    expect(find("completed", "ok").durationMs).toBeGreaterThanOrEqual(3);
    expect(find("retry", "bad").error).toBeInstanceOf(Error);
    expect(typeof find("retry", "bad").durationMs).toBe("number");
    expect(typeof find("failed", "bad").durationMs).toBe("number");
  });

  it("unsubscribes, survives a throwing observer, and is cleared by dispose()", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });
    const kept = vi.fn();
    const dropped = vi.fn();
    queue.observe(() => {
      throw new Error("observer bug");
    });
    queue.observe(kept);
    queue.observe(dropped)();

    expect(() => queue.enqueue("a", 1)).not.toThrow();
    expect(kept).toHaveBeenCalledOnce();
    expect(dropped).not.toHaveBeenCalled();

    queue.dispose();
    queue.enqueue("a", 2);
    expect(kept).toHaveBeenCalledOnce();
  });
});

describe("detach()", () => {
  it("keeps the job active without holding a slot until complete()", async () => {
    const started: string[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      concurrency: 1,
      handlers: {
        native: (id: unknown, ctx: JobContext) => {
          started.push(id as string);
          return ctx.detach(`task-${id}`);
        },
      },
    });
    const completed = vi.fn();
    queue.on("completed", completed);

    const a = queue.enqueue("native", "a");
    queue.enqueue("native", "b");

    await vi.waitFor(() => expect(started).toEqual(["a", "b"]));
    expect(queue.getJobs().map((job) => [job.status, job.externalId])).toEqual([
      ["active", "task-a"],
      ["active", "task-b"],
    ]);

    expect(queue.complete(a.id)).toBe(true);
    expect(completed).toHaveBeenCalledOnce();
    expect(queue.getStats().total).toBe(1);
  });

  it("stays active across a restart instead of being re-run", async () => {
    const storage = memoryStorage();
    const first = createQueue({
      storage,
      handlers: { native: (_: unknown, ctx: JobContext) => ctx.detach("t1") },
    });
    const job = first.enqueue("native", null);
    await vi.waitFor(() => expect(first.getJobs()[0]?.externalId).toBe("t1"));
    first.dispose();

    const handler = vi.fn();
    const second = createQueue({ storage, handlers: { native: handler } });
    await sleep(10);

    expect(second.getJobs()[0]).toMatchObject({ status: "active", externalId: "t1" });
    expect(handler).not.toHaveBeenCalled();
    expect(second.complete(job.id)).toBe(true);
    expect(second.getStats().total).toBe(0);
  });

  it("fail() retries through the handler, then gives up after maxAttempts", async () => {
    const queue = createQueue({
      storage: memoryStorage(),
      retry: { ...fastRetry, maxAttempts: 2 },
      handlers: { native: (_: unknown, ctx: JobContext) => ctx.detach(`t${ctx.attempt}`) },
    });
    const job = queue.enqueue("native", null);
    await vi.waitFor(() => expect(queue.getJobs()[0]?.externalId).toBe("t1"));

    expect(queue.fail(job.id, new Error("upload died"))).toBe(true);
    await vi.waitFor(() => expect(queue.getJobs()[0]?.externalId).toBe("t2"));
    expect(queue.getJobs()[0]).toMatchObject({ attempts: 1, lastError: "upload died" });

    expect(queue.fail(job.id)).toBe(true);
    const failed = queue.getJobs()[0]!;
    expect(failed).toMatchObject({
      status: "failed",
      attempts: 2,
      lastError: "External task failed",
    });
    expect(failed.externalId).toBeUndefined();
  });

  it("complete() and fail() ignore unknown, pending and non-detached jobs", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });
    const pending = queue.enqueue("a", 1);

    for (const id of ["missing", pending.id]) {
      expect(queue.complete(id)).toBe(false);
      expect(queue.fail(id)).toBe(false);
    }
  });
});

describe("progress()", () => {
  it("is clamped, saved on the job, and ignored once the job is gone", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let saved!: JobContext;
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: {
        a: async (_: unknown, ctx: JobContext) => {
          saved = ctx;
          ctx.progress(0.5);
          await hold;
        },
      },
    });

    queue.enqueue("a", null);
    await vi.waitFor(() => expect(queue.getJobs()[0]?.progress).toBe(0.5));
    saved.progress(7);
    expect(queue.getJobs()[0]!.progress).toBe(1);
    saved.progress(-3);
    expect(queue.getJobs()[0]!.progress).toBe(0);

    release();
    await vi.waitFor(() => expect(queue.getStats().total).toBe(0));
    expect(() => saved.progress(0.9)).not.toThrow();
    expect(queue.getJobs()).toEqual([]);
  });

  it("is ignored after a failed attempt", async () => {
    vi.useFakeTimers();
    let saved!: JobContext;
    const queue = createQueue({
      storage: memoryStorage(),
      retry: { baseDelayMs: 300, maxDelayMs: 300, jitter: false },
      handlers: {
        a: (_: unknown, ctx: JobContext) => {
          saved = ctx;
          ctx.progress(0.8);
          throw new Error("boom");
        },
      },
    });

    queue.enqueue("a", null);
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getJobs()[0]).toMatchObject({ status: "pending", attempts: 1 });
    saved.progress(0.4);

    expect(queue.getJobs()[0]!.progress).toBe(0.8);
  });
});

describe("limits", () => {
  it("caps concurrency per job type without blocking other types", async () => {
    const current = { a: 0, b: 0 };
    const peak = { a: 0, b: 0 };
    const work = (type: "a" | "b") => async () => {
      peak[type] = Math.max(peak[type], ++current[type]);
      await sleep(10);
      current[type]--;
    };
    const queue = createQueue({
      storage: memoryStorage(),
      concurrency: 5,
      limits: { a: { concurrency: 1 } },
      handlers: { a: work("a"), b: work("b") },
    });

    for (let i = 0; i < 3; i++) queue.enqueue("a", i);
    for (let i = 0; i < 2; i++) queue.enqueue("b", i);

    await vi.waitFor(() => expect(queue.getStats().total).toBe(0));
    expect(peak).toEqual({ a: 1, b: 2 });
  });

  it("rate-limits starts per job type over a rolling window", async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      limits: { r: { rate: { max: 2, perMs: 60 } } },
      handlers: { r: () => void times.push(Date.now()) },
    });

    for (let i = 0; i < 3; i++) queue.enqueue("r", i);

    await vi.advanceTimersByTimeAsync(0);
    expect(times).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(59);
    expect(times).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toHaveLength(3);
  });
});

describe("RetryAfterError", () => {
  it("schedules the retry after the requested delay instead of the backoff", async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const retries: Job[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      retry: fastRetry,
      handlers: {
        a: () => {
          times.push(Date.now());
          if (times.length === 1) throw new RetryAfterError(40);
        },
      },
    });
    queue.on("retry", (job) => retries.push(job));

    queue.enqueue("a", null);

    await vi.advanceTimersByTimeAsync(0);
    expect(times).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(39); // the 1 ms backoff would already have fired
    expect(times).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(times).toHaveLength(2);
    expect(retries[0]!.lastError).toBe("Retry after 40ms");
  });
});

describe("ttlMs", () => {
  it("expires pending jobs that cannot run, offline or without a handler", async () => {
    vi.useFakeTimers();
    const network = fakeNetwork(false);
    const expired = vi.fn();
    const queue = createQueue({
      storage: memoryStorage(),
      network,
      handlers: { a: vi.fn() },
    });
    queue.on("expired", expired);

    queue.enqueue("a", 1, { ttlMs: 20 });
    queue.enqueue("orphan", 2, { ttlMs: 20 });

    await vi.advanceTimersByTimeAsync(19);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledTimes(2);
    expect(queue.getStats().total).toBe(0);
  });

  it("lets jobs that start before the deadline run normally", async () => {
    const handler = vi.fn();
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: { a: handler },
      autoStart: false,
    });

    const job = queue.enqueue("a", 1, { ttlMs: 10_000 });
    queue.start();

    expect(job.expiresAt).toBeGreaterThan(Date.now());
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(queue.getStats().total).toBe(0));
  });

  it("retry() clears the deadline so a revived job is not immediately dropped", async () => {
    vi.useFakeTimers();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new NonRetryableError("no"))
      .mockResolvedValue(undefined);
    const queue = createQueue({ storage: memoryStorage(), handlers: { a: handler } });

    const job = queue.enqueue("a", 1, { ttlMs: 30 });
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.getStats().failed).toBe(1);
    await vi.advanceTimersByTimeAsync(50);
    queue.retry(job.id);
    await vi.advanceTimersByTimeAsync(0);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(queue.getStats().total).toBe(0);
  });
});

describe("migrations", () => {
  const save = (storage: ReturnType<typeof memoryStorage>, id: string, extra: object, type = "a") =>
    storage.set(
      `queuekit:default:job:${id}`,
      JSON.stringify({
        id,
        type,
        payload: { name: "x" },
        status: "pending",
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        createdAt: 1,
        runAt: 1,
        requiresNetwork: true,
        ...extra,
      }),
    );

  it("upgrades saved payloads once on load and persists the result", () => {
    const storage = memoryStorage();
    save(storage, "old", {});
    save(storage, "v1", { version: 1 });
    save(storage, "current", { version: 2, payload: { full: true } });
    save(storage, "other", {}, "b");
    save(storage, "broken", { payload: "boom" });
    const migrate = vi.fn((payload: unknown, from: number) => {
      if (payload === "boom") throw new Error("cannot");
      return { ...(payload as object), from };
    });

    const queue = createQueue({
      storage,
      autoStart: false,
      migrations: { a: { version: 2, migrate } },
    });
    const byId = (id: string) => queue.getJobs().find((job) => job.id === id)!;

    expect(byId("old")).toMatchObject({ payload: { name: "x", from: 1 }, version: 2 });
    expect(byId("v1")).toMatchObject({ payload: { name: "x", from: 1 }, version: 2 });
    expect(byId("current").payload).toEqual({ full: true });
    expect(byId("other").version).toBeUndefined();
    expect(byId("broken")).toMatchObject({
      status: "failed",
      lastError: "Migration failed: cannot",
    });
    expect(migrate).toHaveBeenCalledTimes(3);
    expect(JSON.parse(storage.getString("queuekit:default:job:old")!).version).toBe(2);
  });

  it("stamps new jobs with the current payload version", () => {
    const queue = createQueue({
      storage: memoryStorage(),
      autoStart: false,
      migrations: { a: { version: 3, migrate: (payload) => payload } },
    });

    expect(queue.enqueue("a", {}).version).toBe(3);
    expect(queue.enqueue("b", {}).version).toBeUndefined();
  });
});
