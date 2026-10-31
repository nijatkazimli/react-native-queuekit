import { backoffDelay, DEFAULT_RETRY } from "./core/backoff.js";
import { Detached } from "./core/detached.js";
import { NonRetryableError, RetryAfterError, TimeoutError } from "./core/errors.js";
import { createLease } from "./core/lease.js";
import { alwaysOnline } from "./platform/network.js";
import type {
  DrainOptions,
  EnqueueOptions,
  Job,
  JobContext,
  JobFilter,
  JobHandler,
  Queue,
  QueueConfig,
  QueueEvent,
  QueueEventInfo,
  QueueStats,
} from "./types.js";

type EventListener = (job: Job, error?: unknown) => void;

// Links a decorated method to its job type so it can be enqueued by reference.
const methodJobs = new WeakMap<object, { type: string; defaults: EnqueueOptions }>();

function isIterator(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { next?: unknown }).next === "function"
  );
}

// Runs sync, async and (async) generator handlers; each yield is an abort checkpoint.
async function invoke(handler: JobHandler, ctx: JobContext) {
  const result = handler(ctx.job.payload, ctx);
  if (!isIterator(result)) return result;
  for await (const _ of result) {
    if (ctx.signal.aborted) break;
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const SECRET_KEY = /token|password|secret|authorization/i;

// First secret-looking key in a payload, looking a few levels deep.
function findSecretKey(value: unknown, depth = 0): string | undefined {
  if (typeof value !== "object" || value === null || depth > 2) return undefined;
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) return key;
    const found = findSecretKey(inner, depth + 1);
    if (found) return found;
  }
  return undefined;
}

const byteLength = (text: string) => encodeURIComponent(text).replace(/%[A-F\d]{2}/g, "U").length;

/**
 * Create a queue. Jobs saved by a previous session are loaded immediately, and
 * ones that were running when the app died are queued to run again.
 *
 * @example
 * const queue = createQueue({
 *   storage: createMMKV({ id: 'queuekit' }),
 *   network: netInfoMonitor(NetInfo),
 * });
 */
export function createQueue(config: QueueConfig): Queue {
  const {
    name = "default",
    storage,
    network = alwaysOnline,
    concurrency = 3,
    timeoutMs = 30_000,
    autoStart = true,
    strict = (globalThis as { __DEV__?: boolean }).__DEV__ !== true,
    lease: leaseConfig = false,
    limits = {},
    migrations = {},
    retention,
    maxPayloadBytes = 65_536,
  } = config;
  const retryPolicy = { ...DEFAULT_RETRY, ...config.retry };
  const prefix = `queuekit:${name}:job:`;
  const leaseEnabled = leaseConfig !== false;
  const leaseTtl = typeof leaseConfig === "object" ? (leaseConfig.ttlMs ?? 15_000) : 15_000;
  const lease = createLease(storage, `queuekit:${name}:lease`, leaseTtl);

  const handlers = new Map<string, JobHandler>(
    Object.entries(config.handlers ?? {}) as [string, JobHandler][],
  );
  const jobs = new Map<string, Job>();
  // Maps a running job id to a function that aborts it.
  const running = new Map<string, (reason: Error) => void>();
  const listeners = new Set<() => void>();
  const eventListeners = new Map<QueueEvent, Set<EventListener>>();
  const observers = new Set<(info: QueueEventInfo) => void>();
  // Re-checked on every change by pending drain() calls.
  const drainChecks = new Set<() => void>();
  const runningByType = new Map<string, number>();
  // Recent start times per type, for rate limits.
  const starts = new Map<string, number[]>();

  let started = false;
  const warnedKeys = new Set<string>();
  let lastCreatedAt = -1;
  // Only the leader runs jobs. Without a lease, every queue is its own leader.
  let leader = !leaseEnabled;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let online = network.isOnline();
  let unsubscribeNetwork: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let jobsSnapshot: Job[] | undefined;
  let statsSnapshot: QueueStats | undefined;

  // Synchronous storage means jobs are fully loaded before enqueue() can be called.
  for (const key of storage.getAllKeys()) {
    if (!key.startsWith(prefix)) continue;
    const job = parseJob(key, !leaseEnabled); // with a lease, recovery waits until we lead
    if (job) jobs.set(job.id, job);
  }

  // `recover` turns a job that was running into a pending one: its process is gone.
  function parseJob(key: string, recover: boolean): Job | undefined {
    const raw = storage.getString(key);
    if (!raw) return undefined;
    try {
      const job = migrate(JSON.parse(raw) as Job);
      // A detached job is waiting on an external task, so it is not interrupted.
      return recover && job.status === "active" && !job.externalId
        ? { ...job, status: "pending" }
        : job;
    } catch {
      storage.remove(key);
      return undefined;
    }
  }

  function migrate(job: Job): Job {
    const spec = migrations[job.type];
    const from = job.version ?? 1;
    if (!spec || from >= spec.version) return job;
    let next: Job;
    try {
      next = { ...job, payload: spec.migrate(job.payload, from), version: spec.version };
    } catch (error) {
      next = { ...job, status: "failed", lastError: `Migration failed: ${describe(error)}` };
    }
    storage.set(prefix + job.id, JSON.stringify(next));
    return next;
  }

  // Replace what this instance knows with what is in storage (jobs it is running stay as they are).
  function reload(recover: boolean) {
    const fresh = new Map<string, Job>();
    for (const key of storage.getAllKeys()) {
      if (!key.startsWith(prefix)) continue;
      const job = parseJob(key, recover);
      if (job) fresh.set(job.id, job);
    }
    for (const id of running.keys()) {
      const mine = jobs.get(id);
      if (mine) fresh.set(id, mine);
    }
    jobs.clear();
    for (const [id, job] of fresh) jobs.set(id, job);
    changed();
  }

  // Jobs another instance enqueued since we last looked.
  function importNew() {
    let added = false;
    for (const key of storage.getAllKeys()) {
      if (!key.startsWith(prefix) || jobs.has(key.slice(prefix.length))) continue;
      const job = parseJob(key, false);
      if (!job) continue;
      jobs.set(job.id, job);
      added = true;
    }
    if (added) changed();
  }

  function takeOver(): boolean {
    if (leader) return true;
    if (!lease.acquire()) return false;
    leader = true;
    reload(true); // the previous leader is gone, so what it was running is interrupted
    return true;
  }

  function releaseLease() {
    if (heartbeat !== undefined) clearTimeout(heartbeat);
    heartbeat = undefined;
    if (!leaseEnabled || !leader) return;
    lease.release();
    leader = false;
  }

  function beat() {
    heartbeat = undefined;
    if (leader) {
      if (lease.acquire()) importNew();
      else leader = false; // another instance took over
    } else if (started && !takeOver()) {
      reload(false); // follow along so this instance's view stays current
    }
    if (leader && started) pump();
    heartbeat = setTimeout(beat, leaseTtl / 3); // stop() and the last job finishing clear it
  }

  function checkDrains() {
    for (const check of drainChecks) check();
  }

  function changed() {
    jobsSnapshot = undefined;
    statsSnapshot = undefined;
    for (const listener of listeners) listener();
    checkDrains();
  }

  function emit(
    event: QueueEvent,
    original: Job,
    extra: { error?: unknown; durationMs?: number; result?: unknown } = {},
  ) {
    // A faulty listener must not break the queue.
    const guard = (call: () => void) => {
      try {
        call();
      } catch {
        // ignored
      }
    };
    const job = original.sensitive ? { ...original, payload: undefined } : original;
    const info = original.sensitive ? { ...extra, result: undefined } : extra;
    for (const listener of eventListeners.get(event) ?? []) guard(() => listener(job, info.error));
    for (const observer of observers) guard(() => observer({ event, job, ...info }));
  }

  function update(job: Job, patch: Partial<Job>): Job {
    const next = { ...job, ...patch };
    jobs.set(next.id, next);
    storage.set(prefix + next.id, JSON.stringify(next));
    changed();
    return next;
  }

  function drop(id: string) {
    jobs.delete(id);
    storage.remove(prefix + id);
    changed();
  }

  // Decides whether a job may start, given its orderKey: it must be the oldest unfinished job
  // with that key, and none may be running.
  function orderGate(now: number): (job: Job) => boolean {
    const head = new Map<string, Job>();
    const busy = new Set<string>();
    for (const job of jobs.values()) {
      const key = job.orderKey;
      if (key === undefined || job.status === "failed") continue;
      // About to be dropped as expired, so it must not hold up the jobs behind it.
      if (job.status === "pending" && job.expiresAt !== undefined && job.expiresAt <= now) continue;
      if (job.status === "active") busy.add(key);
      const first = head.get(key);
      if (!first || job.createdAt < first.createdAt) head.set(key, job);
    }
    return (job) =>
      job.orderKey === undefined || (head.get(job.orderKey) === job && !busy.has(job.orderKey));
  }

  // Deletes failed jobs beyond the retention limits. Returns when the next one is due to go.
  function applyRetention(failed: Job[], now: number): number {
    const failedAt = (job: Job) => job.failedAt ?? job.createdAt;
    const keep: Job[] = [];
    let nextWake = Infinity;
    for (const job of failed.sort((a, b) => failedAt(a) - failedAt(b))) {
      const due =
        retention?.failedTtlMs === undefined ? Infinity : failedAt(job) + retention.failedTtlMs;
      if (due <= now) {
        drop(job.id);
        emit("removed", job);
      } else {
        keep.push(job);
        nextWake = Math.min(nextWake, due);
      }
    }
    const max = retention?.maxFailed ?? Infinity;
    for (const job of keep.splice(0, Math.max(0, keep.length - max))) {
      drop(job.id);
      emit("removed", job);
    }
    return nextWake;
  }

  function pump() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (!started || !leader) return;

    const now = Date.now();
    let nextWake = Infinity;
    const ready: Job[] = [];
    const expired: Job[] = [];
    const failed: Job[] = [];
    const mayStart = orderGate(now);
    for (const job of jobs.values()) {
      if (job.status === "failed") failed.push(job);
      if (job.status !== "pending") continue;
      if (job.expiresAt !== undefined) {
        if (job.expiresAt <= now) {
          expired.push(job);
          continue;
        }
        nextWake = Math.min(nextWake, job.expiresAt);
      }
      if (!handlers.has(job.type) || !mayStart(job)) continue;
      if (job.requiresNetwork && !online) continue;
      if (job.runAt > now) {
        nextWake = Math.min(nextWake, job.runAt);
        continue;
      }
      ready.push(job);
    }
    expired.forEach((job) => {
      drop(job.id);
      emit("expired", job);
    });
    ready.sort((a, b) => b.priority - a.priority || a.runAt - b.runAt || a.createdAt - b.createdAt);
    if (retention) nextWake = Math.min(nextWake, applyRetention(failed, now));

    for (const job of ready) {
      if (running.size >= concurrency) break;
      const limit = limits[job.type];
      if (
        limit?.concurrency !== undefined &&
        (runningByType.get(job.type) ?? 0) >= limit.concurrency
      )
        continue;
      if (limit?.rate) {
        const { max, perMs } = limit.rate;
        const recent = (starts.get(job.type) ?? []).filter((time) => time > now - perMs);
        starts.set(job.type, recent);
        if (recent.length >= max) {
          // biome-ignore lint/style/noNonNullAssertion: recent holds at least `max` entries here
          nextWake = Math.min(nextWake, recent[0]! + perMs);
          continue;
        }
        recent.push(now);
      }
      void run(job);
    }
    if (nextWake !== Infinity) timer = setTimeout(pump, Math.max(0, nextWake - Date.now()));
  }

  async function run(job: Job) {
    // biome-ignore lint/style/noNonNullAssertion: pump only starts jobs whose handler exists
    const handler = handlers.get(job.type)!;
    const controller = new AbortController();
    let rejectAborted!: (reason: Error) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = reject;
    });
    const abort = (reason: Error) => {
      rejectAborted(reason);
      controller.abort();
    };
    running.set(job.id, abort);
    runningByType.set(job.type, (runningByType.get(job.type) ?? 0) + 1);

    const startedAt = Date.now();
    const attemptTimeout = job.timeoutMs ?? timeoutMs;
    const active = update(job, { status: "active", progress: undefined, externalId: undefined });
    emit("started", active);
    const timeout = setTimeout(() => abort(new TimeoutError(attemptTimeout)), attemptTimeout);

    const ctx: JobContext = {
      job: active,
      attempt: active.attempts + 1,
      signal: controller.signal,
      progress: (value) => {
        const current = jobs.get(active.id);
        if (current?.status === "active")
          update(current, { progress: Math.min(1, Math.max(0, value)) });
      },
      detach: (externalId) => new Detached(externalId),
    };

    let result: unknown;
    let error: unknown;
    let ok = false;
    try {
      result = await Promise.race([invoke(handler, ctx), aborted]);
      ok = true;
    } catch (e) {
      error = e;
    } finally {
      clearTimeout(timeout);
      running.delete(job.id);
      // biome-ignore lint/style/noNonNullAssertion: incremented when this run started
      runningByType.set(job.type, runningByType.get(job.type)! - 1);
      if (!started && running.size === 0) releaseLease();
    }

    const durationMs = Date.now() - startedAt;
    const current = jobs.get(job.id);
    // The job was removed while running.
    if (current?.status !== "active") {
      pump();
      return;
    }

    if (ok && result instanceof Detached) {
      update(current, { externalId: result.externalId });
    } else if (ok) {
      drop(job.id);
      emit("completed", active, { durationMs, result });
    } else {
      handleFailure(current, error, durationMs);
    }
    pump();
  }

  function handleFailure(job: Job, error: unknown, durationMs?: number) {
    const lastError = describe(error);
    const fatal = error instanceof NonRetryableError;

    // Losing connectivity mid-run is not the job's fault: requeue without spending an attempt.
    if (!fatal && job.requiresNetwork && !network.isOnline()) {
      online = false;
      emit("requeued", update(job, { status: "pending", lastError, externalId: undefined }));
      return;
    }

    const attempts = job.attempts + 1;
    if (fatal || attempts >= job.maxAttempts) {
      const failed = update(job, {
        status: "failed",
        attempts,
        lastError,
        externalId: undefined,
        failedAt: Date.now(),
      });
      emit("failed", failed, { error, durationMs });
    } else {
      const policy = { ...retryPolicy, ...job.retry };
      const delay =
        error instanceof RetryAfterError ? error.delayMs : backoffDelay(attempts, policy);
      const runAt = Date.now() + delay;
      const next = update(job, {
        status: "pending",
        attempts,
        lastError,
        runAt,
        externalId: undefined,
      });
      emit("retry", next, { error, durationMs });
    }
  }

  function getJobs(filter?: JobFilter): Job[] {
    jobsSnapshot ??= [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
    if (!filter) return jobsSnapshot;
    return jobsSnapshot.filter(
      (job) =>
        (!filter.status || job.status === filter.status) &&
        (!filter.type || job.type === filter.type),
    );
  }

  function enqueue(
    target: string | ((...args: never[]) => unknown),
    payload: unknown,
    options: EnqueueOptions = {},
  ): Job {
    if (typeof target !== "string") {
      const meta = methodJobs.get(target);
      if (!meta) throw new Error("enqueue: method is not decorated with @queue.handler");
      return enqueue(meta.type, payload, { ...meta.defaults, ...options });
    }
    const type = target;
    const existing =
      (options.id && jobs.get(options.id)) ||
      (options.dedupeKey &&
        [...jobs.values()].find((j) => j.dedupeKey === options.dedupeKey && j.status !== "failed"));
    if (existing) return existing;

    if (maxPayloadBytes !== Infinity) {
      const size = byteLength(JSON.stringify(payload) ?? "");
      if (size > maxPayloadBytes) {
        throw new Error(
          `enqueue: payload for "${type}" is ${size} bytes, over maxPayloadBytes (${maxPayloadBytes}). Store large data on disk and enqueue its path.`,
        );
      }
    }
    const secret = options.sensitive ? undefined : findSecretKey(payload);
    if (secret && (globalThis as { __DEV__?: boolean }).__DEV__ === true) {
      const note = `${type}.${secret}`;
      if (!warnedKeys.has(note)) {
        warnedKeys.add(note);
        console.warn(
          `[queuekit] "${type}" payload has a secret-looking key "${secret}". Payloads are stored on disk: pass sensitive: true, use an encrypted storage, or enqueue a reference instead.`,
        );
      }
    }
    const now = Date.now();
    // Strictly increasing, so jobs enqueued in the same millisecond keep their order.
    const createdAt = Math.max(now, lastCreatedAt + 1);
    lastCreatedAt = createdAt;
    const job: Job = {
      id: options.id ?? `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      type,
      payload,
      status: "pending",
      priority: options.priority ?? 0,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? options.retry?.maxAttempts ?? retryPolicy.maxAttempts,
      createdAt,
      runAt: now + (options.delayMs ?? 0),
      requiresNetwork: options.requiresNetwork ?? true,
      dedupeKey: options.dedupeKey,
      expiresAt: options.ttlMs === undefined ? undefined : now + options.ttlMs,
      version: migrations[type]?.version,
      orderKey: options.orderKey,
      timeoutMs: options.timeoutMs,
      retry: options.retry,
      sensitive: options.sensitive,
    };
    update(job, {});
    emit("enqueued", job);
    pump();
    return job;
  }

  function register(type: string, handler: JobHandler) {
    const existing = handlers.get(type);
    if (strict && existing && existing !== handler) {
      throw new Error(`Job type "${type}" is already defined with a different handler`);
    }
    handlers.set(type, handler);
    pump();
  }

  function flush() {
    if (leaseEnabled && started) takeOver();
    online = network.isOnline();
    pump();
  }

  // True when nothing is running and nothing that is allowed to run before `deadline` is waiting.
  function isIdle(deadline: number) {
    if (running.size > 0) return false;
    if (!started || !leader) return true;
    const mayStart = orderGate(Date.now());
    for (const job of jobs.values()) {
      const startable =
        handlers.has(job.type) && !(job.requiresNetwork && !online) && mayStart(job);
      if (job.status === "pending" && startable && job.runAt <= deadline) return false;
    }
    return true;
  }

  function drain({ timeoutMs }: DrainOptions = {}): Promise<boolean> {
    flush();
    const deadline = timeoutMs === undefined ? Infinity : Date.now() + timeoutMs;
    return new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      function finish(idle: boolean) {
        drainChecks.delete(check);
        clearTimeout(timeout);
        resolve(idle);
      }
      function check() {
        if (isIdle(deadline)) finish(true);
      }
      if (timeoutMs !== undefined) timeout = setTimeout(() => finish(false), timeoutMs);
      drainChecks.add(check);
      check();
    });
  }

  const queue: Queue = {
    enqueue: enqueue as Queue["enqueue"],
    register,

    handler(type, defaults = {}) {
      return (method, context) => {
        methodJobs.set(method, { type, defaults });
        // Runs per instance so the handler is bound to `this`.
        context.addInitializer(function () {
          register(type, (method as unknown as JobHandler).bind(this));
        });
      };
    },

    define<P>(type: string, handler: JobHandler<P>, defaults: EnqueueOptions = {}) {
      register(type, handler as JobHandler);
      const fn = (payload: P, options?: EnqueueOptions) =>
        enqueue(type, payload, { ...defaults, ...options }) as Job<P>;
      return Object.assign(fn, { type });
    },

    start() {
      if (started) return;
      started = true;
      if (leaseEnabled) {
        takeOver();
        if (heartbeat === undefined) heartbeat = setTimeout(beat, leaseTtl / 3);
      }
      online = network.isOnline();
      unsubscribeNetwork = network.subscribe((value) => {
        online = value;
        if (value) pump();
        checkDrains();
      });
      pump();
    },

    stop() {
      started = false;
      checkDrains();
      unsubscribeNetwork?.();
      unsubscribeNetwork = undefined;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      // A job still running keeps the lease (and its heartbeat) until it finishes.
      if (running.size === 0) releaseLease();
    },

    retry(id) {
      const job = jobs.get(id);
      if (job?.status !== "failed") return false;
      update(job, {
        status: "pending",
        attempts: 0,
        runAt: Date.now(),
        lastError: undefined,
        expiresAt: undefined,
        failedAt: undefined,
      });
      pump();
      return true;
    },

    complete(id) {
      const job = jobs.get(id);
      if (!job?.externalId) return false;
      drop(id);
      emit("completed", job);
      pump();
      return true;
    },

    fail(id, error) {
      const job = jobs.get(id);
      if (!job?.externalId) return false;
      handleFailure(job, error ?? new Error("External task failed"));
      pump();
      return true;
    },

    remove(id) {
      const job = jobs.get(id);
      if (!job) return false;
      running.get(id)?.(new Error("Job removed"));
      drop(id);
      emit("removed", job);
      return true;
    },

    clear() {
      for (const id of [...jobs.keys()]) queue.remove(id);
    },

    flush,
    drain,
    isLeader: () => leader,

    getJobs,

    getStats() {
      if (!statsSnapshot) {
        const all = getJobs();
        statsSnapshot = {
          pending: all.filter((j) => j.status === "pending").length,
          active: all.filter((j) => j.status === "active").length,
          failed: all.filter((j) => j.status === "failed").length,
          total: all.length,
        };
      }
      return statsSnapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    on(event, listener) {
      const set = eventListeners.get(event) ?? new Set();
      set.add(listener);
      eventListeners.set(event, set);
      return () => {
        set.delete(listener);
      };
    },

    observe(listener) {
      observers.add(listener);
      return () => {
        observers.delete(listener);
      };
    },

    dispose() {
      queue.stop();
      listeners.clear();
      eventListeners.clear();
      observers.clear();
    },
  };

  if (autoStart) queue.start();
  return queue;
}
