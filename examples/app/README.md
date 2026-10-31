# QueueKit Lab

An Expo app for trying every feature of `@nijatk/react-native-queuekit` by hand.

| Tab       | What it does                                                                                                                                                                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard | Stats, start/stop/flush/drain/clear, simulated offline, a restart that reloads from storage, a leader-lease lab with extra instances, background tasks                                                                                                                       |
| Lab       | A custom `enqueue()` builder plus one card per feature: retries, backoff, `RetryAfterError`, timeouts, cancellation, generator and detached jobs, priority, delay, expiry, dedupe, `orderKey`, limits, sensitive payloads, size limit, migrations, crash recovery, retention |
| Queue     | `useJobs()` with filters, progress, retry, remove, complete and fail for detached jobs, plus a details view with the raw stored value                                                                                                                                        |
| Events    | Everything `queue.observe()` reports, with durations, results and errors                                                                                                                                                                                                     |
| Settings  | Every `createQueue()` option, a backoff preview, a storage inspector and a `parseRetryAfter()` tester                                                                                                                                                                        |

It uses the library from this repository (`../../dist`), so local changes show up after a rebuild.

## Run it

```sh
cd examples/app
npm install
npm run ios        # or: npm run android (builds a development client, needs Xcode / Android Studio)
npm start          # later runs: starts Metro for the installed development client
npm run web        # quick check in a browser; MMKV uses its web implementation there
```

`npm start`, `ios`, `android` and `web` rebuild the library first. Expo Go cannot run the app because MMKV is a native module; use the development client.

## Notes

- Background tasks only work on a device or simulator, and the OS decides when they run. "Trigger now" on the Dashboard runs one immediately in development builds.
- The Lab's "Secret-looking keys" card logs a warning to the Metro console (development builds only).
- Decorators (`@queue.handler`) are not used here because they need extra Babel setup; see the docs.
- `npm run typecheck` checks the app against the library sources.
