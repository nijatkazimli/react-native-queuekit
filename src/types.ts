import type { RetryPolicy } from "./core/backoff.js";
import type { Detached } from "./core/detached.js";
import type { NetworkMonitor } from "./platform/network.js";
import type { QueueStorage } from "./platform/storage.js";

/**
 * Lifecycle state of a stored job.
 *
 * - `pending`: waiting to run (not yet due, offline, or waiting for a free slot).
 * - `active`: a handler is running it right now, or it was detached to an
 *   external task (see `ctx.detach()`) and is waiting for `complete()` / `fail()`.
 * - `failed`: out of retries or rejected with `NonRetryableError`. Kept until you
 *   call `retry(id)` or `remove(id)`.
 *
 * Completed jobs are deleted, so there is no `completed` status.
 */
export type JobStatus = "pending" | "active" | "failed";

/**
 * A persisted unit of work. Jobs are plain JSON, stored under one storage key each.
 *
 * @typeParam P - Payload type. Must be JSON-serializable.
 */
export interface Job<P = unknown> {
  /** Unique id. Also a good idempotency key for your backend. */
  id: string;
  /** Name that selects the handler, e.g. `"uploadPhoto"`. */
  type: string;
  /** Data passed to the handler. */
  payload: P;
  status: JobStatus;
  /** Higher runs first. */
  priority: number;
  /** Failed attempts so far. Offline failures are not counted. */
  attempts: number;
  /** Attempts allowed before the job becomes `failed`. */
  maxAttempts: number;
  /** Creation time, epoch ms. */
  createdAt: number;
  /** Earliest time (epoch ms) the job may run. Moves forward on each retry. */
  runAt: number;
  /** If true, the job only runs while the device is online. */
  requiresNetwork: boolean;
  /** Key used to skip duplicate enqueues. */
  dedupeKey?: string;
  /** Message of the most recent error, if any. */
  lastError?: string;
  /** Progress of the current attempt from 0 to 1, as reported by `ctx.progress()`. */
  progress?: number;
  /** Id of the external task this job is waiting on, while detached. */
  externalId?: string;
  /** Time (epoch ms) after which a still-pending job is dropped. Set by `ttlMs`. */
  expiresAt?: number;
  /** Payload version, stamped from `QueueConfig.migrations`. Missing means 1. */
  version?: number;
  /** Jobs with the same key run one at a time, oldest first. See `EnqueueOptions.orderKey`. */
  orderKey?: string;
  /** Per-attempt timeout for this job in ms, overriding the queue's `timeoutMs`. */
  timeoutMs?: number;
  /** Retry settings for this job, overriding the queue's `retry`. */
  retry?: Partial<RetryPolicy>;
  /** When the job became `failed`, epoch ms. Used by `retention`. */
  failedAt?: number;
  /** Payload is hidden from events and `observe()`. See `EnqueueOptions.sensitive`. */
  sensitive?: boolean;
}

/** Per-job settings accepted by `enqueue()` and as defaults by `define()` / `handler()`. */
export interface EnqueueOptions {
  /**
   * Use a specific id instead of a generated one. If a job with this id already
   * exists it is returned and nothing is enqueued.
   */
  id?: string;
  /** Higher runs first. Default 0. */
  priority?: number;
  /** Attempts before the job is marked `failed`. Default: the queue's `retry.maxAttempts`. */
  maxAttempts?: number;
  /** Wait this long before the first attempt. Default 0. */
  delayMs?: number;
  /** Hold the job until the device is online. Default true. */
  requiresNetwork?: boolean;
  /**
   * Skip enqueueing if a non-failed job with this key already exists; the existing
   * job is returned instead.
   */
  dedupeKey?: string;
  /**
   * Drop the job, emitting `expired`, if it is still pending (not started yet, or
   * waiting to retry) this many ms after being enqueued. Works while offline.
   * Running jobs are never expired.
   */
  ttlMs?: number;
  /**
   * Run jobs that share this key strictly one at a time, in the order they were enqueued,
   * even across retries. A job waits while an earlier job with the same key is pending
   * (for example waiting out a backoff) or running. A `failed` earlier job does not block
   * later ones. Priority is ignored within a key. Different keys run in parallel.
   */
  orderKey?: string;
  /** Per-attempt timeout in ms for this job. Default: the queue's `timeoutMs`. */
  timeoutMs?: number;
  /**
   * Retry settings for this job, merged over the queue's `retry`. `retry.maxAttempts`
   * counts unless `maxAttempts` is given too.
   */
  retry?: Partial<RetryPolicy>;
  /**
   * Hide the payload from `on()` / `observe()` listeners (their job has `payload: undefined`),
   * so it cannot leak into logs or analytics. The handler still gets it, and it is still
   * stored: use an encrypted storage (MMKV `encryptionKey`) to protect it at rest.
   * Also silences the development warning about secret-like payload keys.
   */
  sensitive?: boolean;
}

/**
 * Second argument of every handler.
 *
 * @typeParam P - Payload type.
 */
export interface JobContext<P = unknown> {
  /** The job being run, including its id and attempt counters. */
  job: Job<P>;
  /** 1-based attempt number. */
  attempt: number;
  /**
   * Aborted on timeout or when the job is removed. Pass it to `fetch` and other
   * cancellable APIs so the work stops too.
   */
  signal: AbortSignal;
  /**
   * Report progress of this attempt, from 0 to 1 (values are clamped). It is saved
   * on the job as `job.progress`, so UIs can read it with `useJob()`. Ignored once
   * the attempt has ended.
   */
  progress(value: number): void;
  /**
   * Hand the work to something that outlives the JS runtime, such as a native
   * background upload. `return ctx.detach(uploadId)` from the handler (not from a
   * generator). The job stays `active` and frees its concurrency slot, with no
   * timeout, until you call `queue.complete(id)` or `queue.fail(id)`. After an app
   * restart it is still `active`, so reattach by looking up `job.externalId`.
   */
  detach(externalId: string): Detached;
}

/**
 * Does the work for a job. Can be sync, async, or a generator (`function*` /
 * `async function*`, where each `yield` is an abort checkpoint).
 *
 * Return or resolve to succeed. Throw to retry with backoff, or throw
 * `NonRetryableError` to fail immediately. Handlers may run more than once for the
 * same job (for example after a crash), so make them idempotent.
 *
 * @typeParam P - Payload type.
 */
export type JobHandler<P = unknown> = (payload: P, ctx: JobContext<P>) => unknown;

/** Handlers by job type, for `QueueConfig.handlers`. Prefer `define()`, which also types the payload. */
export type Handlers = Record<string, JobHandler>;

/** Options for `createQueue()`. */
export interface QueueConfig {
  /** Isolates jobs when several queues share one storage. Default `"default"`. */
  name?: string;
  /** Where jobs are persisted. A `react-native-mmkv` instance works directly. */
  storage: QueueStorage;
  /** Handlers registered up front. You can also use `define()` or `@handler` instead. */
  handlers?: Handlers;
  /** Connectivity source. Default: always online. See `netInfoMonitor`. */
  network?: NetworkMonitor;
  /** Max jobs running at once. Default 3. */
  concurrency?: number;
  /** Per-attempt timeout in ms; the attempt is aborted and retried. Default 30000. */
  timeoutMs?: number;
  /** Overrides for the default retry policy. */
  retry?: Partial<RetryPolicy>;
  /** Extra limits for specific job types, keyed by type name. */
  limits?: Record<string, TypeLimit>;
  /**
   * Upgrade payloads saved by older app versions, keyed by job type. Applied once
   * when the queue loads, before anything runs.
   */
  migrations?: Record<string, Migration>;
  /**
   * Clean up `failed` jobs automatically so they do not pile up. Cleaned-up jobs are
   * deleted and emit `removed`. Without it, failed jobs stay until you retry or remove them.
   */
  retention?: {
    /** Keep at most this many failed jobs; the oldest failures are deleted first. */
    maxFailed?: number;
    /** Delete a failed job this many ms after it failed. */
    failedTtlMs?: number;
  };
  /** Start processing immediately. Default true. */
  autoStart?: boolean;
  /**
   * Largest payload `enqueue()` accepts, as UTF-8 bytes of its JSON. Larger ones throw, because
   * every job is kept in memory and rewritten on each state change. Default 65536; use
   * `Infinity` to disable. Put big files on disk and enqueue their path instead.
   */
  maxPayloadBytes?: number;
  /**
   * Throw if a job type is defined a second time with a different handler, which
   * would silently replace the first. Re-registering the identical function is
   * allowed. Default: on, except in development builds (`__DEV__`), where Fast
   * Refresh re-runs definitions with new function objects. A second instance of a
   * class using `@handler` also counts as a different handler.
   */
  strict?: boolean;
  /**
   * Let only one queue instance that shares this storage and `name` run jobs at a time.
   * The instance that holds the lease is the leader. Others keep accepting `enqueue()`
   * (the leader picks those jobs up) and take over if the leader stops or dies.
   * Pass `{ ttlMs }` to set how long a lease lasts without renewal (default 15000).
   * Default false.
   *
   * Storage has no atomic compare-and-set, so this makes double runs very unlikely, not
   * impossible: keep handlers idempotent.
   */
  lease?: boolean | { ttlMs?: number };
}

/** Limits for one job type, in addition to the queue-wide `concurrency`. */
export interface TypeLimit {
  /** Max jobs of this type running at once. */
  concurrency?: number;
  /** Start at most `max` jobs of this type per rolling `perMs` window. */
  rate?: { max: number; perMs: number };
}

/** Upgrades the saved payloads of one job type to its current shape. */
export interface Migration {
  /** Current payload version. New jobs are stamped with it. */
  version: number;
  /**
   * Return the payload upgraded to `version`. Throwing marks that job `failed` with
   * the error as `lastError`.
   *
   * @param fromVersion - Version the job was saved with (1 if it had none).
   */
  migrate(payload: unknown, fromVersion: number): unknown;
}

/** Job counts by status. Returned by `queue.getStats()`. */
export interface QueueStats {
  pending: number;
  active: number;
  failed: number;
  /** Sum of all statuses. */
  total: number;
}

/** Narrows `getJobs()` and `useJobs()`. Omitted fields match everything. */
export interface JobFilter {
  status?: JobStatus;
  /** Job type name, e.g. `uploadPhoto.type`. */
  type?: string;
}

/**
 * Events emitted by a queue, for logging and analytics.
 *
 * - `enqueued`: a job was added.
 * - `started`: an attempt began.
 * - `completed`: the handler succeeded and the job was deleted.
 * - `retry`: an attempt failed and another is scheduled.
 * - `failed`: the job gave up. The listener also receives the error.
 * - `expired`: a pending job outlived its `ttlMs` and was dropped.
 * - `removed`: a job was deleted by `remove()`, `clear()` or `retention`.
 * - `requeued`: connectivity dropped mid-attempt, so the job went back to `pending`
 *   without using an attempt.
 */
export type QueueEvent =
  | "enqueued"
  | "started"
  | "completed"
  | "retry"
  | "failed"
  | "expired"
  | "removed"
  | "requeued";

/** What `queue.observe()` listeners receive for every event. */
export interface QueueEventInfo {
  event: QueueEvent;
  /** The job as it was when the event fired. */
  job: Job;
  /** The error behind a `retry` or `failed` event. */
  error?: unknown;
  /**
   * How long the attempt ran, in ms, for `completed`, `retry` and `failed` events
   * of jobs run in this process. Missing for other events, and for jobs finished
   * through `queue.complete()` / `queue.fail()`.
   */
  durationMs?: number;
  /**
   * What the handler returned, for `completed` events of jobs run in this process. It is
   * not stored, so it is gone after the event. Missing for generator and detached jobs.
   */
  result?: unknown;
}

/**
 * A job declared with `queue.define()`. Calling it enqueues the job.
 *
 * @typeParam P - Payload type, taken from the handler.
 * @example
 * const uploadPhoto = queue.define('uploadPhoto', async (p: { uri: string }) => { ... });
 * uploadPhoto({ uri }, { dedupeKey: uri });
 */
export interface JobFn<P> {
  /** Enqueue the job. Call-site options override the defaults given to `define()`. */
  (payload: P, options?: EnqueueOptions): Job<P>;
  /** The job type name, e.g. for `useJobs({ type: uploadPhoto.type })`. */
  readonly type: string;
}

/**
 * Method decorator returned by `queue.handler()`. Supports instance and `static`
 * methods, using standard (TC39) decorators.
 */
// biome-ignore lint/suspicious/noExplicitAny: ClassMethodDecoratorContext requires `any` params
export type HandlerDecorator = <This, Fn extends (this: This, ...args: any[]) => unknown>(
  method: Fn,
  context: ClassMethodDecoratorContext<This, Fn>,
) => void;

/** Options for `queue.drain()`. */
export interface DrainOptions {
  /**
   * Give up waiting after this many ms and resolve `false`. Jobs that would not
   * start before then (long delays or backoff) are not waited for. Always set it
   * in a background task, where the OS ends your execution window.
   */
  timeoutMs?: number;
}

/**
 * A persistent, network-aware job queue. Create one with `createQueue()`.
 */
export interface Queue {
  /**
   * Declare a job: registers its handler and returns a typed function that enqueues it.
   * Defining the same `type` again replaces the handler.
   *
   * @param type - Job type name, stored with each job.
   * @param handler - Does the work. The payload type is inferred from its first parameter.
   * @param defaults - Options applied to every call; call-site options win.
   * @example
   * export const uploadPhoto = queue.define(
   *   'uploadPhoto',
   *   async ({ uri }: { uri: string }, { signal }) => { await upload(uri, signal); },
   *   { priority: 5 },
   * );
   * uploadPhoto({ uri });
   */
  define<P>(type: string, handler: JobHandler<P>, defaults?: EnqueueOptions): JobFn<P>;

  /**
   * Method decorator that registers a class method as the handler for `type`.
   * Instance methods register when the class is instantiated, bound to that
   * instance (the last instance wins, so keep one per class). `static` methods
   * register once when the class is defined. Enqueue with
   * `queue.enqueue(instance.method, payload)`.
   *
   * @param type - Job type name, stored with each job.
   * @param defaults - Options applied whenever the method is enqueued.
   * @example
   * ```ts
   * class Profile {
   *   @queue.handler('updateProfile')
   *   async update(patch: Patch, { signal }: JobContext) { ... }
   * }
   * ```
   */
  handler(type: string, defaults?: EnqueueOptions): HandlerDecorator;

  /**
   * Save a job by type name and schedule it. The job is written to storage before this
   * returns. If `options.id` or `options.dedupeKey` matches an existing job, that job is
   * returned instead and nothing is added. The payload is not type-checked: prefer
   * `define()`, which is.
   *
   * @param type - Job type name.
   * @param payload - JSON-serializable data for the handler.
   */
  enqueue(type: string, payload: unknown, options?: EnqueueOptions): Job;
  /**
   * Enqueue a method decorated with `@queue.handler`. The payload type comes from
   * the method. Throws if the method is not decorated.
   */
  enqueue<P>(
    method: (payload: P, ctx: JobContext<P>) => unknown,
    payload: P,
    options?: EnqueueOptions,
  ): Job<P>;

  /**
   * Lower-level handler registration by name. Prefer `define()` or `@handler`.
   * Jobs whose type has no handler stay `pending` until one is registered.
   */
  register(type: string, handler: JobHandler): void;

  /**
   * Start processing and listening for connectivity changes. No-op if already
   * started. Called automatically unless `autoStart` is false.
   */
  start(): void;

  /** Stop picking up new jobs. Jobs already running finish. Resume with `start()`. */
  stop(): void;

  /**
   * Re-read connectivity and start everything that is due now. Call it when the
   * app returns to the foreground (see `flushOnForeground`), since timers and
   * network events may have been missed while it was suspended. Does nothing if
   * the queue is stopped.
   */
  flush(): void;

  /**
   * Flush, then wait until the queue has nothing left it can do right now: no job
   * is running and no job that is allowed to run is waiting (jobs offline-blocked,
   * without a handler, or detached to an external task are not waited for). Use it
   * to run the queue inside an OS background task and return when done.
   *
   * @returns `true` if the queue went idle, `false` if `timeoutMs` ran out first.
   *   Jobs still running then keep running; if the OS kills the app they run again
   *   on the next launch.
   * @example
   * await queue.drain({ timeoutMs: 20_000 });
   */
  drain(options?: DrainOptions): Promise<boolean>;

  /**
   * Re-queue a `failed` job with a fresh attempt budget.
   *
   * @returns false if the job does not exist or is not failed.
   */
  retry(id: string): boolean;

  /**
   * Cancel and delete a job in any state. A running job is aborted through its
   * `signal`.
   *
   * @returns false if the job does not exist.
   */
  remove(id: string): boolean;

  /** Remove every job, aborting any that are running. */
  clear(): void;

  /**
   * Current jobs, oldest first. Without a filter the same array is returned until
   * something changes, so it is safe to use as a React snapshot.
   */
  getJobs(filter?: JobFilter): Job[];

  /** Job counts by status. The same object is returned until something changes. */
  getStats(): QueueStats;

  /**
   * Call `listener` after any change to jobs. Compatible with
   * `useSyncExternalStore`.
   *
   * @returns A function that unsubscribes.
   */
  subscribe(listener: () => void): () => void;

  /**
   * Listen to lifecycle events, e.g. for logging or analytics. Listener errors are
   * swallowed so they cannot break the queue.
   *
   * @returns A function that unsubscribes.
   * @example
   * queue.on('failed', (job, error) => report(error, { type: job.type }));
   */
  on(event: QueueEvent, listener: (job: Job, error?: unknown) => void): () => void;

  /**
   * Listen to every event with one callback, including `durationMs`. This is the
   * hook for analytics and crash-reporting tools. Listener errors are swallowed.
   *
   * @returns A function that unsubscribes.
   * @example
   * queue.observe(({ event, job, durationMs }) =>
   *   analytics.logEvent(`queue_${event}`, { type: job.type, durationMs }));
   */
  observe(listener: (info: QueueEventInfo) => void): () => void;

  /**
   * Finish a job that was detached with `ctx.detach()`: it is deleted and
   * `completed` fires.
   *
   * @returns false if the job does not exist or is not detached.
   */
  complete(id: string): boolean;

  /**
   * Report that a detached job's external task failed. The job is retried (a new
   * attempt runs its handler again) or marked `failed`, exactly as if the handler
   * had thrown.
   *
   * @param error - Why it failed. Stored as `lastError`.
   * @returns false if the job does not exist or is not detached.
   */
  fail(id: string, error?: unknown): boolean;

  /**
   * Whether this instance is currently allowed to run jobs. Always true unless the queue
   * was created with `lease`, where it is true only while this instance holds the lease.
   */
  isLeader(): boolean;

  /** Stop the queue and drop all listeners. Stored jobs are kept. */
  dispose(): void;
}
