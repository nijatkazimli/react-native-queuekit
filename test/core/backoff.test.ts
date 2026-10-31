import { describe, expect, it } from "vitest";
import { backoffDelay, DEFAULT_RETRY, parseRetryAfter } from "../../src/core/backoff.js";

const policy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 1000, jitter: false };

describe("backoffDelay", () => {
  it("doubles each attempt and caps at maxDelayMs", () => {
    expect([1, 2, 3, 4, 5].map((attempt) => backoffDelay(attempt, policy))).toEqual([
      100, 200, 400, 800, 1000,
    ]);
  });

  it("jitters within [50%, 100%] of the delay", () => {
    const jittered = { ...policy, jitter: true };

    expect(backoffDelay(1, jittered, () => 0)).toBe(50);
    expect(backoffDelay(1, jittered, () => 1)).toBe(100);
  });

  it("uses Math.random by default", () => {
    const delay = backoffDelay(3, DEFAULT_RETRY);

    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(4000);
  });
});

describe("parseRetryAfter", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");

  it.each([
    [undefined, undefined],
    [null, undefined],
    ["", undefined],
    ["not a date", undefined],
    ["120", 120_000],
    ["0", 0],
    ["-5", 0],
    ["Thu, 01 Jan 2026 00:00:30 GMT", 30_000],
    ["Wed, 31 Dec 2025 23:59:00 GMT", 0],
  ])("parses %s as %s ms", (value, expected) => {
    expect(parseRetryAfter(value, now)).toBe(expected);
  });

  it("defaults to the current time", () => {
    const delay = parseRetryAfter(new Date(Date.now() + 60_000).toUTCString())!;

    expect(delay).toBeGreaterThan(55_000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });
});
