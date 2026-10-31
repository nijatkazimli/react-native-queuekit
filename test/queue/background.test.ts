import { describe, expect, it, vi } from "vitest";
import type { JobContext, NetworkMonitor } from "../../src/index.js";
import { createQueue, flushOnForeground, memoryStorage } from "../../src/index.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeNetwork(initial = true) {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();
  const monitor: NetworkMonitor & { set(value: boolean): void; setSilently(value: boolean): void } =
    {
      isOnline: () => online,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set(value) {
        online = value;
        for (const listener of listeners) listener(value);
      },
      setSilently(value) {
        online = value;
      },
    };
  return monitor;
}

describe("flush()", () => {
  it("re-reads connectivity that changed without an event and runs due jobs", async () => {
    const network = fakeNetwork(false);
    const handler = vi.fn();
    const queue = createQueue({ storage: memoryStorage(), network, handlers: { a: handler } });
    queue.enqueue("a", 1);

    network.setSilently(true);
    await sleep(10);
    expect(handler).not.toHaveBeenCalled();

    queue.flush();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  });
});

describe("drain()", () => {
  it("resolves true once everything runnable has finished, including retries", async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error("flaky")).mockResolvedValue(undefined);
    const queue = createQueue({
      storage: memoryStorage(),
      retry: { baseDelayMs: 5, maxDelayMs: 5, jitter: false },
      autoStart: false,
      handlers: { a: handler },
    });
    queue.enqueue("a", 1);
    queue.enqueue("a", 2);
    queue.start();

    await expect(queue.drain()).resolves.toBe(true);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(queue.getStats().total).toBe(0);
  });

  it("resolves true immediately when there is nothing to do", async () => {
    const queue = createQueue({ storage: memoryStorage() });

    await expect(queue.drain({ timeoutMs: 1000 })).resolves.toBe(true);
  });

  it("does not wait for offline-blocked jobs, jobs without a handler, or detached jobs", async () => {
    const network = fakeNetwork(false);
    const queue = createQueue({
      storage: memoryStorage(),
      network,
      handlers: { net: vi.fn(), native: (_: unknown, ctx: JobContext) => ctx.detach("t") },
    });
    queue.enqueue("net", 1);
    queue.enqueue("orphan", 2);
    queue.enqueue("native", 3, { requiresNetwork: false });

    await expect(queue.drain({ timeoutMs: 1000 })).resolves.toBe(true);

    expect(queue.getStats()).toMatchObject({ pending: 2, active: 1 });
  });

  it("ignores jobs that would not start before the timeout", async () => {
    const handler = vi.fn();
    const queue = createQueue({ storage: memoryStorage(), handlers: { a: handler } });
    queue.enqueue("a", 1, { delayMs: 60_000 });

    await expect(queue.drain({ timeoutMs: 50 })).resolves.toBe(true);

    expect(handler).not.toHaveBeenCalled();
  });

  it("resolves false when a job is still running at the timeout", async () => {
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: { a: () => new Promise(() => {}) },
    });
    queue.enqueue("a", 1);

    await expect(queue.drain({ timeoutMs: 20 })).resolves.toBe(false);

    expect(queue.getStats().active).toBe(1);
  });

  it("resolves when the queue is stopped, and when the device goes offline mid-drain", async () => {
    const network = fakeNetwork(true);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const queue = createQueue({
      storage: memoryStorage(),
      network,
      concurrency: 1,
      handlers: { a: () => hold },
    });
    queue.enqueue("a", 1);
    queue.enqueue("a", 2);

    const offline = queue.drain();
    network.set(false);
    release();
    await expect(offline).resolves.toBe(true);
    expect(queue.getStats().pending).toBe(1);

    network.set(true);
    const stopped = queue.drain();
    queue.stop();
    await expect(stopped).resolves.toBe(true);
  });

  it("resolves true for a stopped queue", async () => {
    const queue = createQueue({
      storage: memoryStorage(),
      autoStart: false,
      handlers: { a: vi.fn() },
    });
    queue.enqueue("a", 1);

    await expect(queue.drain()).resolves.toBe(true);
  });
});

describe("flushOnForeground()", () => {
  it("flushes when the app becomes active and stops after unsubscribing", () => {
    const flush = vi.fn();
    const remove = vi.fn();
    let listener: (state: string) => void = () => {};
    const appState = {
      addEventListener: (_type: "change", fn: (state: string) => void) => {
        listener = fn;
        return { remove };
      },
    };

    const stop = flushOnForeground({ flush }, appState);
    listener("background");
    listener("inactive");
    expect(flush).not.toHaveBeenCalled();

    listener("active");
    expect(flush).toHaveBeenCalledOnce();

    stop();
    expect(remove).toHaveBeenCalledOnce();
  });
});
