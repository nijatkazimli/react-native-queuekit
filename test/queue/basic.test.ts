import { describe, expect, it, vi } from "vitest";
import type { JobContext, NetworkMonitor } from "../../src/index.js";
import { createQueue, memoryStorage, NonRetryableError } from "../../src/index.js";

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

const fastRetry = { baseDelayMs: 1, maxDelayMs: 5, jitter: false };

describe("createQueue", () => {
  it("runs a job and removes it from storage", async () => {
    const storage = memoryStorage();
    const handler = vi.fn();
    const queue = createQueue({ storage, handlers: { upload: handler } });

    queue.enqueue("upload", { file: "a.jpg" });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(queue.getStats().total).toBe(0));
    expect(handler.mock.calls[0]![0]).toEqual({ file: "a.jpg" });
    expect(storage.getAllKeys()).toEqual([]);
  });

  it("retries with backoff until it succeeds", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const queue = createQueue({
      storage: memoryStorage(),
      retry: fastRetry,
      handlers: { a: handler },
    });

    queue.enqueue("a", null);

    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(queue.getStats().total).toBe(0));
  });

  it("marks a job failed after maxAttempts, and retry() revives it", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("nope"));
    const queue = createQueue({
      storage: memoryStorage(),
      retry: { ...fastRetry, maxAttempts: 2 },
      handlers: { a: handler },
    });

    const job = queue.enqueue("a", null);
    await vi.waitFor(() => expect(queue.getStats().failed).toBe(1));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(queue.getJobs()[0]!.lastError).toBe("nope");

    queue.retry(job.id);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(4));
  });

  it("fails immediately on NonRetryableError", async () => {
    const handler = vi.fn().mockRejectedValue(new NonRetryableError("bad input"));
    const queue = createQueue({ storage: memoryStorage(), handlers: { a: handler } });

    queue.enqueue("a", null);

    await vi.waitFor(() => expect(queue.getStats().failed).toBe(1));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("holds jobs while offline and runs them when back online", async () => {
    const network = fakeNetwork(false);
    const handler = vi.fn();
    const queue = createQueue({ storage: memoryStorage(), network, handlers: { a: handler } });

    queue.enqueue("a", null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handler).not.toHaveBeenCalled();
    expect(queue.getStats().pending).toBe(1);

    network.set(true);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  });

  it("does not spend an attempt when connectivity drops mid-run", async () => {
    const network = fakeNetwork(true);
    const handler = vi
      .fn()
      .mockImplementationOnce(() => {
        network.set(false);
        throw new Error("network request failed");
      })
      .mockResolvedValue(undefined);
    const queue = createQueue({ storage: memoryStorage(), network, handlers: { a: handler } });

    queue.enqueue("a", null);
    await vi.waitFor(() => expect(queue.getJobs()[0]?.status).toBe("pending"));
    expect(queue.getJobs()[0]!.attempts).toBe(0);

    network.set(true);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  });

  it("resumes persisted jobs, including ones interrupted mid-run", async () => {
    const storage = memoryStorage();
    const first = createQueue({ storage, autoStart: false });
    const job = first.enqueue("a", { n: 1 });
    storage.set(`queuekit:default:job:${job.id}`, JSON.stringify({ ...job, status: "active" }));
    first.dispose();

    const handler = vi.fn();
    createQueue({ storage, handlers: { a: handler } });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  });

  it("dedupes by key and respects priority", async () => {
    const order: string[] = [];
    const queue = createQueue({
      storage: memoryStorage(),
      autoStart: false,
      concurrency: 1,
      handlers: { a: (name: unknown) => void order.push(name as string) },
    });

    const first = queue.enqueue("a", "low", { dedupeKey: "k" });
    expect(queue.enqueue("a", "dup", { dedupeKey: "k" }).id).toBe(first.id);
    queue.enqueue("a", "high", { priority: 10 });
    queue.start();

    await vi.waitFor(() => expect(order).toEqual(["high", "low"]));
  });

  it("limits concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const queue = createQueue({
      storage: memoryStorage(),
      concurrency: 2,
      handlers: {
        a: async () => {
          peak = Math.max(peak, ++inFlight);
          await new Promise((resolve) => setTimeout(resolve, 10));
          inFlight--;
        },
      },
    });

    for (let i = 0; i < 5; i++) queue.enqueue("a", i);

    await vi.waitFor(() => expect(queue.getStats().total).toBe(0));
    expect(peak).toBe(2);
  });

  it("times out hung handlers", async () => {
    const queue = createQueue({
      storage: memoryStorage(),
      timeoutMs: 20,
      retry: { maxAttempts: 1 },
      handlers: { a: () => new Promise(() => {}) },
    });

    queue.enqueue("a", null);

    await vi.waitFor(() => expect(queue.getStats().failed).toBe(1));
    expect(queue.getJobs()[0]!.lastError).toMatch(/timed out/);
  });

  it("aborts a running job when removed", async () => {
    let signal: AbortSignal | undefined;
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: {
        a: (_: unknown, ctx) => {
          signal = ctx.signal;
          return new Promise(() => {});
        },
      },
    });

    const job = queue.enqueue("a", null);
    await vi.waitFor(() => expect(signal).toBeDefined());
    queue.remove(job.id);

    expect(signal!.aborted).toBe(true);
    expect(queue.getStats().total).toBe(0);
  });

  it("runs generator handlers to completion and retries when they throw", async () => {
    const steps: number[] = [];
    let calls = 0;
    const queue = createQueue({
      storage: memoryStorage(),
      retry: fastRetry,
      handlers: {
        sync: function* () {
          steps.push(++calls);
          yield;
          if (calls === 1) throw new Error("mid-generator failure");
          steps.push(99);
        },
        stream: async function* () {
          await Promise.resolve();
          steps.push(-1);
          yield 1;
        },
      },
    });

    queue.enqueue("sync", null);
    queue.enqueue("stream", null);

    await vi.waitFor(() => expect(queue.getStats().total).toBe(0));
    expect(steps).toContain(99);
    expect(steps).toContain(-1);
    expect(calls).toBe(2);
  });

  it("registers decorated class methods and enqueues them by reference", async () => {
    const queue = createQueue({ storage: memoryStorage() });

    class Photos {
      uploaded: string[] = [];
      async upload(payload: { uri: string }, _ctx?: JobContext) {
        this.uploaded.push(payload.uri);
      }
    }
    // The test transformer can't parse decorator syntax, so apply it the way the language does.
    const initializers: (() => void)[] = [];
    queue.handler("upload", { priority: 3 })(Photos.prototype.upload, {
      addInitializer: (fn: () => void) => initializers.push(fn),
    } as never);
    const photos = new Photos();
    for (const init of initializers) init.call(photos);

    const job = queue.enqueue(photos.upload, { uri: "a.jpg" });
    expect(job).toMatchObject({ type: "upload", priority: 3 });

    await vi.waitFor(() => expect(photos.uploaded).toEqual(["a.jpg"]));
    expect(() => queue.enqueue(() => {}, null)).toThrow(/@queue.handler/);
  });

  it("define() returns a typed function that enqueues with default options", async () => {
    const handler = vi.fn();
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });
    const upload = queue.define("upload", handler, { priority: 7, maxAttempts: 2 });

    const job = upload({ uri: "a.jpg" });
    expect(upload.type).toBe("upload");
    expect(job).toMatchObject({ type: "upload", priority: 7, maxAttempts: 2 });
    expect(upload({ uri: "b.jpg" }, { priority: 1 }).priority).toBe(1);

    queue.start();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
  });
});
