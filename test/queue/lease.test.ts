import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueueConfig, QueueStorage } from "../../src/index.js";
import { createQueue, memoryStorage } from "../../src/index.js";

const LEASE_KEY = "queuekit:default:lease";
const TTL = 300; // heartbeat every 100 ms

afterEach(() => {
  vi.useRealTimers();
});

function setup(storage: QueueStorage, options: Partial<QueueConfig> = {}) {
  const calls: string[] = [];
  const queue = createQueue({
    storage,
    lease: { ttlMs: TTL },
    handlers: { a: (payload: unknown) => void calls.push(String(payload)) },
    ...options,
  });
  return { queue, calls };
}

const steal = (storage: QueueStorage, until: number) =>
  storage.set(LEASE_KEY, JSON.stringify({ owner: "thief", until }));

function begin() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  return memoryStorage();
}

describe("lease", () => {
  it("lets only the leader run jobs, and the leader picks up jobs a follower enqueued", async () => {
    const storage = begin();
    const a = setup(storage);
    const b = setup(storage);
    expect([a.queue.isLeader(), b.queue.isLeader()]).toEqual([true, false]);

    b.queue.enqueue("a", "from-b");
    a.queue.enqueue("a", "from-a");
    await vi.advanceTimersByTimeAsync(0);
    expect(a.calls).toEqual(["from-a"]);

    await vi.advanceTimersByTimeAsync(100); // the leader's heartbeat finds the follower's job
    expect(a.calls).toEqual(["from-a", "from-b"]);
    expect(b.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(100); // and the follower's view catches up
    expect(b.queue.getStats().total).toBe(0);
  });

  it("takes over from a leader that died and re-runs what it was running", async () => {
    const storage = begin();
    storage.set(LEASE_KEY, JSON.stringify({ owner: "dead", until: 1000 }));
    storage.set(
      "queuekit:default:job:j1",
      JSON.stringify({
        id: "j1",
        type: "a",
        payload: "x",
        status: "active",
        priority: 0,
        attempts: 0,
        maxAttempts: 3,
        createdAt: 0,
        runAt: 0,
        requiresNetwork: true,
      }),
    );
    const b = setup(storage);

    expect(b.queue.isLeader()).toBe(false);
    expect(b.queue.getJobs()[0]?.status).toBe("active"); // not recovered while following
    await vi.advanceTimersByTimeAsync(900);
    expect(b.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(200);
    expect(b.queue.isLeader()).toBe(true);
    expect(b.calls).toEqual(["x"]);
  });

  it("is released by stop() when idle, so another instance can lead at once", async () => {
    const storage = begin();
    const a = setup(storage);
    const b = setup(storage);

    a.queue.stop();
    expect(a.queue.isLeader()).toBe(false);
    b.queue.flush();

    expect(b.queue.isLeader()).toBe(true);
  });

  it("keeps the lease while a job is still running after stop()", async () => {
    const storage = begin();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const a = setup(storage, { handlers: { a: () => hold } });
    const b = setup(storage);
    a.queue.enqueue("a", "1");
    await vi.advanceTimersByTimeAsync(0);

    a.queue.stop();
    expect(a.queue.isLeader()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000); // renewed the whole time
    b.queue.flush();
    expect(b.queue.isLeader()).toBe(false);

    a.queue.start(); // restarting while the heartbeat is still alive
    a.queue.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(a.queue.isLeader()).toBe(false);
    b.queue.flush();
    expect(b.queue.isLeader()).toBe(true);
  });

  it("steps down when another instance takes the lease", async () => {
    const storage = begin();
    const a = setup(storage);

    steal(storage, 100_000);
    await vi.advanceTimersByTimeAsync(100);

    expect(a.queue.isLeader()).toBe(false);
  });

  it("keeps a running job when it regains the lease after losing it", async () => {
    const storage = begin();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    let runs = 0;
    const a = setup(storage, {
      handlers: {
        a: () => {
          runs++;
          return hold;
        },
      },
    });
    a.queue.enqueue("a", "1");
    await vi.advanceTimersByTimeAsync(0);

    steal(storage, 500);
    await vi.advanceTimersByTimeAsync(100);
    expect(a.queue.isLeader()).toBe(false);
    expect(a.queue.getJobs()[0]?.status).toBe("active"); // still ours while following

    await vi.advanceTimersByTimeAsync(500);
    expect(a.queue.isLeader()).toBe(true);
    expect(a.queue.getJobs()[0]?.status).toBe("active"); // not turned back into pending
    expect(runs).toBe(1);
    release();
  });

  it("keeps its heartbeat after stop() even if it lost the lease, until its job ends", async () => {
    const storage = begin();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const a = setup(storage, { handlers: { a: () => hold } });
    a.queue.enqueue("a", "1");
    await vi.advanceTimersByTimeAsync(0);
    a.queue.stop();

    steal(storage, 100_000);
    await vi.advanceTimersByTimeAsync(300); // loses it, then beats once more while stopped
    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(a.queue.isLeader()).toBe(false);
    expect(a.queue.getStats().total).toBe(0);
  });

  it("does not make drain() wait on a follower", async () => {
    const storage = begin();
    setup(storage);
    const b = setup(storage);
    b.queue.enqueue("a", "1");

    await expect(b.queue.drain()).resolves.toBe(true);
    expect(b.calls).toEqual([]);
  });

  it("removes corrupt entries it finds while importing", async () => {
    const storage = begin();
    setup(storage);
    storage.set("queuekit:default:job:bad", "{nope");

    await vi.advanceTimersByTimeAsync(100);

    expect(storage.getString("queuekit:default:job:bad")).toBeUndefined();
  });

  it("uses a 15 s lease by default and keeps renewing it", async () => {
    const storage = begin();
    const a = setup(storage, { lease: true });
    const b = setup(storage, { lease: true });

    await vi.advanceTimersByTimeAsync(60_000);
    b.queue.flush();

    expect(a.queue.isLeader()).toBe(true);
    expect(b.queue.isLeader()).toBe(false);
  });

  it("is not leader until started, and flush() on a stopped queue does not take over", async () => {
    const storage = begin();
    const a = setup(storage, { autoStart: false });

    expect(a.queue.isLeader()).toBe(false);
    a.queue.flush();
    expect(a.queue.isLeader()).toBe(false);

    a.queue.start();
    expect(a.queue.isLeader()).toBe(true);
  });

  it("a queue without a lease is always its own leader", () => {
    const queue = createQueue({ storage: memoryStorage(), autoStart: false });

    expect(queue.isLeader()).toBe(true);
  });

  it("accepts a lease object without a ttl", () => {
    const queue = createQueue({ storage: begin(), lease: {} });

    expect(queue.isLeader()).toBe(true);
  });

  it("a follower's refresh skips corrupt entries and jobs that were removed while running", async () => {
    const storage = begin();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => (release = resolve));
    const a = setup(storage, { handlers: { a: () => hold } });
    const job = a.queue.enqueue("a", "1");
    await vi.advanceTimersByTimeAsync(0);

    steal(storage, 100_000); // a becomes a follower while its job is still running
    storage.set("queuekit:default:job:bad", "{nope");
    a.queue.remove(job.id);
    vi.advanceTimersByTime(200); // synchronous: the aborted run has not finished yet

    expect(a.queue.isLeader()).toBe(false);
    expect(a.queue.getJobs()).toEqual([]);
    release();
  });
});
