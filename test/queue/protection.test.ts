import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, QueueEventInfo } from "../../src/index.js";
import { createQueue, memoryStorage } from "../../src/index.js";

const dev = globalThis as { __DEV__?: boolean };

afterEach(() => {
  delete dev.__DEV__;
  vi.restoreAllMocks();
});

describe("maxPayloadBytes", () => {
  it("rejects oversized payloads before anything is stored", () => {
    const storage = memoryStorage();
    const queue = createQueue({ storage, maxPayloadBytes: 20, handlers: { t: () => {} } });
    expect(() => queue.enqueue("t", "x".repeat(50))).toThrow(/over maxPayloadBytes/);
    expect(storage.getAllKeys().filter((k) => k.includes(":job:"))).toEqual([]);
  });

  it("counts UTF-8 bytes, and accepts undefined payloads", () => {
    const queue = createQueue({
      storage: memoryStorage(),
      maxPayloadBytes: 7,
      handlers: { t: () => {} },
    });
    // 5 characters but 8 bytes of JSON (2 quotes + 3 two-byte letters).
    expect(() => queue.enqueue("t", "\u00e9\u00e9\u00e9")).toThrow();
    expect(() => queue.enqueue("t", undefined)).not.toThrow();
  });

  it("defaults to 64 KB and can be disabled", () => {
    const queue = createQueue({
      storage: memoryStorage(),
      autoStart: false,
      handlers: { t: () => {} },
    });
    expect(() => queue.enqueue("t", "x".repeat(70_000))).toThrow();
    const open = createQueue({
      storage: memoryStorage(),
      autoStart: false,
      maxPayloadBytes: Number.POSITIVE_INFINITY,
      handlers: { t: () => {} },
    });
    expect(() => open.enqueue("t", "x".repeat(70_000))).not.toThrow();
  });
});

describe("sensitive", () => {
  it("hides payload and result from listeners but not from the handler", async () => {
    const seen: Job[] = [];
    const infos: QueueEventInfo[] = [];
    let received: unknown;
    const queue = createQueue({
      storage: memoryStorage(),
      handlers: {
        t: (payload) => {
          received = payload;
          return "secret-result";
        },
      },
    });
    queue.on("started", (job) => seen.push(job));
    queue.observe((info) => infos.push(info));
    const job = queue.enqueue("t", { pin: 1234 }, { sensitive: true });
    await queue.drain();

    expect(received).toEqual({ pin: 1234 });
    expect(job.payload).toEqual({ pin: 1234 });
    expect(seen[0]?.payload).toBeUndefined();
    expect(infos.length).toBeGreaterThan(0);
    for (const info of infos) {
      expect(info.job.payload).toBeUndefined();
      expect(info.result).toBeUndefined();
    }
  });

  it("leaves other jobs visible", async () => {
    const infos: QueueEventInfo[] = [];
    const queue = createQueue({ storage: memoryStorage(), handlers: { t: () => 1 } });
    queue.observe((info) => infos.push(info));
    queue.enqueue("t", "open");
    await queue.drain();
    expect(infos.every((i) => i.job.payload === "open")).toBe(true);
  });
});

describe("secret-key warning", () => {
  const make = () =>
    createQueue({ storage: memoryStorage(), autoStart: false, handlers: { t: () => {} } });

  it("warns once per type and key in development, looking into nested objects", () => {
    dev.__DEV__ = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = make();
    queue.enqueue("t", { user: { accessToken: "abc" } });
    queue.enqueue("t", { user: { accessToken: "def" } });
    queue.enqueue("t", { Authorization: "Bearer x" });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain("accessToken");
  });

  it("stays quiet outside development, when sensitive, or for harmless and non-object payloads", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const queue = make();
    queue.enqueue("t", { password: "x" });
    dev.__DEV__ = true;
    queue.enqueue("t", { password: "x" }, { sensitive: true });
    queue.enqueue("t", { name: "x", deep: { a: { b: { c: { password: "too deep" } } } } });
    queue.enqueue("t", "token");
    queue.enqueue("t", null);
    expect(warn).not.toHaveBeenCalled();
  });
});
