/**
 * Throw from a handler to fail the job immediately, skipping remaining retries.
 * Use it for errors a retry cannot fix, such as a 4xx response.
 *
 * @example
 * if (res.status === 400) throw new NonRetryableError('rejected by server');
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/** Set as `job.lastError` when an attempt exceeds the queue's `timeoutMs`. Retried like any other error. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Job timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Throw from a handler to retry after a server-specified delay, such as a
 * `Retry-After` header, instead of the exponential backoff. It still counts as a
 * failed attempt, and the delay is used as given (not capped by `maxDelayMs`).
 *
 * @example
 * const delay = parseRetryAfter(res.headers.get('Retry-After'));
 * if (res.status === 429 && delay !== undefined) throw new RetryAfterError(delay);
 */
export class RetryAfterError extends Error {
  /**
   * @param delayMs - Milliseconds to wait before the next attempt.
   * @param message - Stored as `job.lastError`.
   */
  constructor(
    readonly delayMs: number,
    message = `Retry after ${delayMs}ms`,
  ) {
    super(message);
    this.name = "RetryAfterError";
  }
}
