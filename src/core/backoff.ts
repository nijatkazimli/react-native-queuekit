/** How failed jobs are retried. */
export interface RetryPolicy {
  /** Total attempts, including the first, before a job is marked failed. */
  maxAttempts: number;
  /** Delay before the first retry. Doubles on each following retry. */
  baseDelayMs: number;
  /** Upper bound for the delay between retries. */
  maxDelayMs: number;
  /** Randomize each delay within [50%, 100%] to avoid thundering herds. */
  jitter: boolean;
}

/** Defaults: 5 attempts, 1s base delay doubling up to 60s, with jitter. */
export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitter: true,
};

/**
 * Delay before a retry: `baseDelayMs * 2^(attempt - 1)`, capped at `maxDelayMs`,
 * then jittered if enabled.
 *
 * @param attempt - Number of failed attempts so far (1-based).
 * @param random - Source of randomness in [0, 1). Override for deterministic tests.
 * @returns Delay in milliseconds.
 */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return policy.jitter ? Math.round(exp / 2 + (random() * exp) / 2) : exp;
}

/**
 * Parse an HTTP `Retry-After` header, either delta-seconds or an HTTP date.
 *
 * @param value - Header value, e.g. `res.headers.get('Retry-After')`.
 * @param now - Current time in epoch ms. Override for deterministic tests.
 * @returns Milliseconds to wait (never negative), or `undefined` if absent or unparseable.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
