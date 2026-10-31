import { describe, expect, it } from "vitest";
import { RetryAfterError } from "../../src/core/errors.js";

describe("RetryAfterError", () => {
  it("carries the delay and a default or custom message", () => {
    const plain = new RetryAfterError(1500);
    const custom = new RetryAfterError(10, "slow down");

    expect(plain).toMatchObject({
      name: "RetryAfterError",
      delayMs: 1500,
      message: "Retry after 1500ms",
    });
    expect(custom.message).toBe("slow down");
  });
});
