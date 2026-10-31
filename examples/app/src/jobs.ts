import type { Queue } from "@nijatk/react-native-queuekit";
import { NonRetryableError, RetryAfterError } from "@nijatk/react-native-queuekit";

// Rejects when the job is cancelled or times out, so a handler stops doing work.
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

export const JOB_TYPES = [
  "demo.success",
  "demo.flaky",
  "demo.alwaysFail",
  "demo.fatal",
  "demo.retryAfter",
  "demo.hang",
  "demo.resumable",
  "demo.native",
  "demo.sensitive",
  "demo.step",
  "demo.limited",
  "demo.profile",
] as const;

/** Declares every demo job with `queue.define()`, which infers each payload type from its handler. */
export function defineJobs(queue: Queue) {
  return {
    // Reports progress, finishes, and returns a result that observers receive on `completed`.
    success: queue.define("demo.success", async (payload: { ms: number }, ctx) => {
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        await sleep(payload.ms / steps, ctx.signal);
        ctx.progress(i / steps);
      }
      return { finishedAfterAttempt: ctx.attempt };
    }),

    // Fails until `failUntil` attempts have passed: exercises retry with exponential backoff.
    flaky: queue.define("demo.flaky", async (payload: { failUntil: number }, ctx) => {
      await sleep(400, ctx.signal);
      if (ctx.attempt <= payload.failUntil)
        throw new Error(`Server error (attempt ${ctx.attempt})`);
      return `recovered on attempt ${ctx.attempt}`;
    }),

    alwaysFail: queue.define("demo.alwaysFail", async (payload: { code: number }, ctx) => {
      await sleep(300, ctx.signal);
      throw new Error(`HTTP ${payload.code}`);
    }),

    // Gives up at once instead of retrying.
    fatal: queue.define("demo.fatal", async (_payload: Record<string, never>, ctx) => {
      await sleep(300, ctx.signal);
      throw new NonRetryableError("400 Bad Request: this will never succeed");
    }),

    // The first attempt is told to wait, like an HTTP 429 with Retry-After.
    retryAfter: queue.define("demo.retryAfter", async (payload: { delayMs: number }, ctx) => {
      await sleep(300, ctx.signal);
      if (ctx.attempt === 1) throw new RetryAfterError(payload.delayMs, "429 Too Many Requests");
      return "went through after waiting";
    }),

    // Never finishes: only a timeout or removing the job stops it.
    hang: queue.define("demo.hang", async (_payload: Record<string, never>, ctx) => {
      await sleep(10 * 60_000, ctx.signal);
    }),

    // A generator handler: every yield is a checkpoint where cancellation is noticed.
    resumable: queue.define("demo.resumable", async function* (payload: { chunks: number }, ctx) {
      for (let i = 1; i <= payload.chunks; i++) {
        await sleep(450, ctx.signal);
        ctx.progress(i / payload.chunks);
        yield i;
      }
    }),

    // Hands the work to an "external task": the job stays active until complete() or fail() is called.
    native: queue.define("demo.native", (_payload: { file: string }, ctx) =>
      ctx.detach(`native-${ctx.job.id}`),
    ),

    // Marked sensitive per job at enqueue time; the payload never reaches event listeners.
    sensitive: queue.define("demo.sensitive", async (_payload: { pin: string }, ctx) => {
      await sleep(600, ctx.signal);
      return { granted: true, token: "result-also-hidden" };
    }),

    // Used for ordering chains: the first step can fail a few times before succeeding.
    step: queue.define("demo.step", async (payload: { n: number; failFirst: number }, ctx) => {
      await sleep(500, ctx.signal);
      if (ctx.attempt <= payload.failFirst) throw new Error(`Step ${payload.n} failed`);
      return payload.n;
    }),

    // Subject to the per-type limits from Settings (concurrency and rate).
    limited: queue.define("demo.limited", async (_payload: { n: number }, ctx) => {
      await sleep(800, ctx.signal);
    }),

    // Payloads saved by an older app version are upgraded by the migration in the queue config.
    profile: queue.define("demo.profile", async (payload: { name: string }, ctx) => {
      await sleep(300, ctx.signal);
      return `hello ${payload.name}`;
    }),
  };
}

export type Jobs = ReturnType<typeof defineJobs>;

/** What a second define() of an existing type does: throws while `strict` is on, replaces silently otherwise. */
export const redefineSuccess = (queue: Queue) =>
  queue.define("demo.success", async () => "a different handler");

/** A payload in the old (version 1) shape, as an earlier app version would have saved it. */
export const OLD_PROFILE_JOB = (id: string, fullName: string) => ({
  id,
  type: "demo.profile",
  payload: { fullName },
  status: "pending",
  priority: 0,
  attempts: 0,
  maxAttempts: 3,
  createdAt: Date.now(),
  runAt: Date.now() + 60_000,
  requiresNetwork: false,
  version: 1,
});

export const MIGRATIONS = {
  "demo.profile": {
    version: 2,
    migrate: (payload: unknown, from: number) =>
      from < 2 ? { name: (payload as { fullName: string }).fullName } : payload,
  },
};
