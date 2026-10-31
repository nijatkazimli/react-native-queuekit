import { afterEach, describe, expect, it, vi } from "vitest";
import { createLease } from "../../src/core/lease.js";
import { memoryStorage } from "../../src/platform/storage.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("createLease", () => {
  it("is held by one owner at a time until it expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const storage = memoryStorage();
    const a = createLease(storage, "lease", 1000);
    const b = createLease(storage, "lease", 1000);

    expect(a.acquire()).toBe(true);
    expect(b.acquire()).toBe(false);
    expect(a.acquire()).toBe(true); // renewing keeps it

    vi.setSystemTime(999);
    expect(b.acquire()).toBe(false);
    vi.setSystemTime(2500); // a stopped renewing
    expect(b.acquire()).toBe(true);
    expect(a.acquire()).toBe(false);
  });

  it("release() frees the lease only for its owner", () => {
    const storage = memoryStorage();
    const a = createLease(storage, "lease", 60_000);
    const b = createLease(storage, "lease", 60_000);

    a.acquire();
    b.release(); // not the holder: no effect
    expect(b.acquire()).toBe(false);

    a.release();
    expect(b.acquire()).toBe(true);
  });

  it("treats a corrupt record as free", () => {
    const storage = memoryStorage();
    storage.set("lease", "{not json");

    expect(createLease(storage, "lease", 1000).acquire()).toBe(true);
  });

  it("does not claim the lease if the write did not stick", () => {
    const storage = { ...memoryStorage(), set: () => {} };

    expect(createLease(storage, "lease", 1000).acquire()).toBe(false);
  });
});
