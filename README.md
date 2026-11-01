# QueueKit

[![CI](https://github.com/nijatkazimli/react-native-queuekit/actions/workflows/ci.yml/badge.svg)](https://github.com/nijatkazimli/react-native-queuekit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@nijatk/react-native-queuekit)](https://www.npmjs.com/package/@nijatk/react-native-queuekit)
[![license](https://img.shields.io/npm/l/@nijatk/react-native-queuekit)](LICENSE)

[Documentation](https://nijatkazimli.github.io/react-native-queuekit/) · [npm](https://www.npmjs.com/package/@nijatk/react-native-queuekit) · [Changelog](https://github.com/nijatkazimli/react-native-queuekit/releases)

Reliable offline job queue for React Native. Uploads, form submissions and background work survive app kills, flaky networks and crashes, and retry automatically with backoff.

- **Persistent**: every job is written to [MMKV](https://github.com/margelo/react-native-mmkv) synchronously, before `enqueue()` returns.
- **Network-aware**: jobs wait while offline; a drop mid-request doesn't burn a retry.
- **Retries**: exponential backoff with jitter, per-job `maxAttempts`, `NonRetryableError` to give up early.
- **Controls**: priority, concurrency, delay, dedupe keys, timeouts, cancellation via `AbortSignal`.
- **Modular**: core has zero dependencies; React hooks live in `@nijatk/react-native-queuekit/react`; storage and network are plain interfaces.
- **Typed**: `queue.define()` infers the payload type from your handler, so a wrong payload is a compile error.

Full documentation with guides, a cookbook and the API reference lives at [nijatkazimli.github.io/react-native-queuekit](https://nijatkazimli.github.io/react-native-queuekit/) (source in [docs/](docs/index.html)).

## Install

```sh
npm install @nijatk/react-native-queuekit react-native-mmkv react-native-nitro-modules
npm install @react-native-community/netinfo   # optional, for connectivity
```

Tested with the [example app](examples/app) on an iPhone 16 Pro, the iOS simulator (31 end-to-end flows) and a Samsung Galaxy M34 (Android 14).

## Usage

Create the queue once. It only needs storage and (optionally) a network monitor.

```ts
// queue.ts
import NetInfo from '@react-native-community/netinfo';
import { createMMKV } from 'react-native-mmkv';
import { createQueue, netInfoMonitor } from '@nijatk/react-native-queuekit';

export const queue = createQueue({
  storage: createMMKV({ id: 'queuekit' }),
  network: netInfoMonitor(NetInfo),
});
```

Define each job next to the code that uses it. `queue.define` wraps your handler into a typed function:

```ts
// features/photos.ts
import { NonRetryableError } from '@nijatk/react-native-queuekit';
import { queue } from '../queue';

export const uploadPhoto = queue.define(
  'uploadPhoto',
  async ({ uri, albumId }: { uri: string; albumId: string }, { signal }) => {
    const res = await fetch(`https://api.example.com/albums/${albumId}`, {
      method: 'POST',
      body: await readFile(uri),
      signal,
    });
    if (res.status === 400) throw new NonRetryableError('rejected by server');
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // retried
  },
  { priority: 5 }, // default options for every call
);
```

Call it like a function. The payload is type-checked, and the job is saved before it returns:

```ts
uploadPhoto({ uri, albumId }, { dedupeKey: uri });
```

Import your feature modules once at startup so their handlers are registered. Jobs saved in a previous session wait until their handler is defined. The name (`'uploadPhoto'`) is only the persisted job type: it appears once, in the definition.

### Mixing offline and online jobs

`requiresNetwork` defaults to `true`. Set it to `false` for work that doesn't need a connection, so it keeps running offline while network jobs wait. Jobs can enqueue follow-up jobs:

```ts
export const uploadPhoto = queue.define('uploadPhoto', async ({ uri }: { uri: string }, { signal }) => {
  await api.upload(uri, { signal });
});

export const compressPhoto = queue.define(
  'compressPhoto',
  async ({ uri }: { uri: string }) => {
    const small = await compress(uri);
    uploadPhoto({ uri: small }); // waits for connectivity; compression already ran offline
  },
  { requiresNetwork: false },
);
```

This needs a `network` monitor such as `netInfoMonitor(NetInfo)`. Without one the queue assumes the device is always online and ignores `requiresNetwork`.

### Class methods (decorator)

If you prefer services, decorate a method. It is registered when the class is instantiated, bound to `this`:

```ts
class ProfileService {
  @queue.handler('updateProfile', { priority: 5 })
  async update(patch: ProfilePatch, { signal }: JobContext) {
    await api.patch('/profile', patch, { signal });
  }
}
export const profile = new ProfileService(); // one instance per class

queue.enqueue(profile.update, { displayName: 'Ada' }); // payload type comes from the method
```

`static` methods work too and register once when the class is defined (`this` is the class), so they need no instance.

Uses standard (TC39) decorators. In TypeScript leave `experimentalDecorators` off; in a React Native app add `['@babel/plugin-proposal-decorators', { version: '2023-11' }]` to your Babel plugins.

### React

```tsx
import { QueueProvider, useQueueStats, useJobs, useQueue } from '@nijatk/react-native-queuekit/react';

<QueueProvider queue={queue}><App /></QueueProvider>

function SyncBadge() {
  const { pending, failed } = useQueueStats();
  const failedJobs = useJobs({ status: 'failed' });
  const q = useQueue();
  return <Button title={`${pending} waiting, ${failed} failed`} onPress={() => failedJobs.forEach((j) => q.retry(j.id))} />;
}
```

## Beyond the basics

### Running in the background

While your app is suspended or closed, JavaScript does not run, so a queue cannot process jobs on its own. There are three pieces, from cheapest to most involved:

1. **Foreground:** call `flushOnForeground(queue, AppState)` once. When the app becomes active, the queue re-checks connectivity and runs everything that came due while it slept.
2. **Periodic background task:** the OS wakes your app for a short window every so often (you don't control when). Inside it, `await queue.drain({ timeoutMs })` runs what it can and returns when the queue is idle, or when your time budget is spent.
3. **Large uploads:** hand them to a native uploader with `ctx.detach()` (below), which keeps going without JS.

```ts
TaskManager.defineTask(TASK, async () => {
  await queue.drain({ timeoutMs: 20_000 }); // `true` if it finished, `false` if time ran out
  return BackgroundTask.BackgroundTaskResult.Success;
});
```

`drain` does not wait for jobs that cannot run right now (offline, no handler yet, or detached). Always set `timeoutMs` in a background task. A job still running when the OS ends the window runs again on the next launch, so handlers must be idempotent. The task runs without your UI, so import the modules that define your jobs inside it. See [examples/background.ts](examples/background.ts).

### Background uploads that outlive the app

JS timers stop when the OS suspends your app, so a large upload should run in a native background uploader. Return `ctx.detach(taskId)` from the handler: the job stays `active`, frees its concurrency slot, has no timeout, and survives restarts. Tell the queue how it ended with `complete()` or `fail()` (which retries as usual).

```ts
export const uploadVideo = queue.define('uploadVideo', async ({ path }: { path: string }, ctx) => {
  const uploadId = await NativeUploader.start({ path, url });
  watch(ctx.job.id, uploadId);
  return ctx.detach(uploadId);
});

function watch(jobId: string, uploadId: string) {
  NativeUploader.onDone(uploadId, () => queue.complete(jobId));
  NativeUploader.onError(uploadId, (e) => queue.fail(jobId, e));
}

// At startup, reattach to uploads that were running when the app last closed.
for (const job of queue.getJobs({ type: uploadVideo.type, status: 'active' })) {
  if (job.externalId) watch(job.id, job.externalId);
}
```

If the OS finished an upload while your app was not running, make sure your uploader reports it on the next launch (or check it against your backend) and call `complete()` or `fail()` then.

### Analytics and crash reporting

`queue.observe()` is one callback for every event, with the duration of each finished attempt. It maps directly onto Firebase, App Insights, Sentry and similar tools:

```ts
queue.observe(({ event, job, error, durationMs }) => {
  analytics().logEvent(`queue_${event}`, { type: job.type, attempts: job.attempts, duration_ms: durationMs ?? 0 });
  if (event === 'failed') crashlytics().recordError(error as Error);
});
```

Events: `enqueued`, `started`, `completed`, `retry`, `failed`, `expired`, `removed`, `requeued`. `observe()` also gets the handler `result` on `completed`. Use `queue.on(event, fn)` to listen to a single event. Set `retention: { maxFailed, failedTtlMs }` to clean up failed jobs automatically. Payloads over `maxPayloadBytes` (default 64 KB) are rejected; enqueue with `sensitive: true` to hide a payload from events and `observe()`, and use an MMKV `encryptionKey` to encrypt storage.

### Limits, progress, expiry and migrations

```ts
const queue = createQueue({
  storage,
  concurrency: 4,
  limits: {
    uploadVideo: { concurrency: 1 },               // one at a time
    sendMessage: { rate: { max: 5, perMs: 1000 } }, // at most 5 starts per second
  },
  migrations: {
    updateProfile: {
      version: 2,
      // Runs once on load for jobs saved by an older app version.
      migrate: (payload, from) => from === 1 ? { ...(payload as object), locale: 'en' } : payload,
    },
  },
});

// Drop it if it is still waiting after an hour (works offline).
sendReceipt({ orderId }, { ttlMs: 60 * 60 * 1000 });

// Report progress; read it with useJob(id).progress.
queue.define('uploadPhoto', async (p: Photo, { progress, signal }) => {
  await upload(p, { signal, onProgress: (fraction) => progress(fraction) });
});

// Honor the server's Retry-After instead of the exponential backoff.
if (res.status === 429) {
  const delay = parseRetryAfter(res.headers.get('Retry-After'));
  if (delay !== undefined) throw new RetryAfterError(delay);
}
```

## Examples

Complete, copy-pasteable app code in [examples/](examples):

- [queue.ts](examples/queue.ts): the queue with MMKV and NetInfo
- [features/](examples/features): one file per feature, each defining its job with `queue.define()`
- [api.ts](examples/api.ts): shared request helper with idempotency keys and error classification
- [FeedbackForm.tsx](examples/FeedbackForm.tsx): offline-safe form submission
- [PhotoUploads.tsx](examples/PhotoUploads.tsx): upload list with status, retry, cancel and dedupe
- [SyncBanner.tsx](examples/SyncBanner.tsx): global sync status with retry-all
- [events.ts](examples/events.ts): logging with `queue.on`
- [observers.ts](examples/observers.ts): Firebase and Azure Application Insights via `queue.observe`
- [features/background-upload.ts](examples/features/background-upload.ts): native background upload with `ctx.detach()`
- [background.ts](examples/background.ts): periodic background task and foreground flush
- [app/](examples/app): QueueKit Lab, an Expo app to try every feature on a device or in the browser

## API

| | |
|---|---|
| `createQueue({ storage, handlers, network, concurrency, timeoutMs, retry, limits, migrations, name, autoStart, strict, retention, maxPayloadBytes })` | Create a queue. Jobs from the previous session are loaded immediately. `strict` throws when a job type is defined twice with different handlers, instead of silently replacing the first (on by default, except when `__DEV__` is true). `lease` lets only one instance sharing a storage run jobs. |
| `define(type, handler, defaults?)` | Register a handler and get back a typed function that enqueues the job: `uploadPhoto(payload, options?)`. Jobs without a defined handler stay queued. |
| `@queue.handler(type, defaults?)` | Method decorator that registers a class method as a job handler; enqueue with `queue.enqueue(instance.method, payload)`. |
| `enqueue(type, payload, { id, priority, maxAttempts, delayMs, ttlMs, requiresNetwork, dedupeKey, orderKey, timeoutMs, retry, sensitive })` | Lower-level, by name. Persists and schedules a job, returning it synchronously. |
| `register(type, handler)` | Lower-level handler registration. |
| `start()` / `stop()` | Resume / pause processing. Running jobs finish. |
| `flush()` | Re-read connectivity and start everything due now. Use on app foreground. |
| `drain({ timeoutMs? })` | Flush, then wait until nothing more can run now. Resolves `true` when idle, `false` on timeout. For background tasks. |
| `flushOnForeground(queue, AppState)` | Calls `flush()` whenever the app becomes active. Returns an unsubscribe function. |
| `retry(id)` / `remove(id)` / `clear()` | Revive a failed job, cancel (aborts if running), wipe. |
| `getJobs(filter?)` / `getStats()` / `subscribe(fn)` | Inspect state. Snapshots are referentially stable. |
| `on('enqueued' \| 'started' \| 'completed' \| 'retry' \| 'failed' \| 'expired' \| 'removed' \| 'requeued', fn)` | Listen to one lifecycle event. |
| `observe(fn)` | One callback for every event, with `durationMs`. For analytics and crash reporting. |
| `complete(id)` / `fail(id, error?)` | Finish a job that was handed to an external task with `ctx.detach()`. |

Handlers should be **idempotent**: a job interrupted by a crash runs again on next launch (at-least-once delivery). Use the job `id` as an idempotency key with your backend.

Handlers can be sync, `async`, or generators (`function*` / `async function*`). A generator is run to completion, and each `yield` is a checkpoint where an abort or timeout takes effect.

Retry defaults: 5 attempts, 1s base delay doubling up to 60s, with jitter. Override via `retry: { maxAttempts, baseDelayMs, maxDelayMs, jitter }`.

## Custom storage / network

`QueueStorage` is four synchronous methods (`getString`, `set`, `remove`, `getAllKeys`), so any store works. `memoryStorage()` is included for tests. `NetworkMonitor` is `{ isOnline(), subscribe(cb) }`.

## Why MMKV and not a database

Queue state is small, key-addressed and hot: each job is one key, read and written individually. MMKV is a memory-mapped file with synchronous access, so enqueue is crash-safe the moment it returns and there is no async startup or schema. A SQL database earns its keep for querying large relational data, which a job queue doesn't need. If you need to ship large binary payloads, store the file on disk and queue its path.

## Development

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

```text
src/
  index.ts, queue.ts, types.ts   public API, createQueue(), shared types
  core/                          backoff, errors, leader lease, detached tasks
  platform/                      storage, network and app-state adapters
  react/                         hooks and provider (@nijatk/react-native-queuekit/react)
test/                            mirrors src/; test/queue/ holds the queue behavior and property tests
examples/                        copy-pasteable app code; examples/app is a runnable Expo test app
docs/                            documentation site (plain HTML, published to GitHub Pages)
scripts/                         dev tooling (docs server)
.githooks/  .github/workflows/   git hooks and CI
```

```sh
npm run lint            # Biome: lint + format check
npm run format          # apply Biome fixes
npm run typecheck
npm run test:coverage   # 100% coverage is enforced
npm run test:fuzz       # 5000 random operation sequences, including crashes
npm run build
```

Git hooks in `.githooks` run lint, typecheck and tests before commit, and add coverage and build before push. `npm install` enables them through a local `core.hooksPath`, which takes precedence over any global hooks.

### Releasing

`npm run release:patch` (or `release:minor` / `release:major`) bumps the version, tags it and pushes the tag. The workflow in `.github/workflows/publish.yml` then runs lint, typecheck and tests with coverage, builds, publishes to npm with provenance and creates the GitHub release, with notes generated from the commit subjects (`scripts/release-notes.mjs`). A version that is already on npm is skipped, so the very first release can be published by hand (`npm publish --access public`) before its tag is pushed; then add the repository as a trusted publisher in the package's npm settings.

### Documentation site

The site in `docs/` is plain HTML, CSS and JavaScript with no build step. Preview it with `npm run docs` (live reload; `npm run docs -- --open --port 8080`; add `--host 0.0.0.0` to test from a phone on your network). The workflow in `.github/workflows/pages.yml` publishes it to GitHub Pages on every push to `main` that touches `docs/`: in the repository settings, set Pages to "GitHub Actions" once.
