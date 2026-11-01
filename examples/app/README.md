# QueueKit Lab

An Expo app for trying every feature of `@nijatk/react-native-queuekit` by hand.

| Tab       | What it does                                                                                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard | Stats, start/stop/flush/drain/clear, simulated offline, a restart that reloads from storage, a leader-lease lab with extra instances, background tasks                                                                                                   |
| Lab       | 25 guided tests in 7 groups. Tap one to see HOW TO TEST and YOU SHOULD SEE, then press its numbered buttons in order and compare with Queue or Events. "Reset everything" gives each test a clean slate. A custom `enqueue()` builder sits at the bottom |
| Queue     | `useJobs()` with filters, progress, retry, remove, complete and fail for detached jobs, plus a details view with the raw stored value                                                                                                                    |
| Events    | Everything `queue.observe()` reports, with durations, results and errors                                                                                                                                                                                 |
| Settings  | Every `createQueue()` option, a backoff preview, a storage inspector and a `parseRetryAfter()` tester                                                                                                                                                    |

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

## End-to-end tests

`.maestro/` holds [Maestro](https://maestro.mobile.dev) flows that drive the real app, one flow per Lab test plus the Dashboard, Settings, Queue and Events screens (31 in total). They run against a Release build, so the JS is bundled and no Metro server or development menu is involved.

```sh
brew install mobile-dev-inc/tap/maestro            # once (also needs Java 17+)
npm run ios:release                                # builds and installs the Release app on a simulator
npm run e2e                                        # runs every flow; or: maestro test .maestro/01-basic-job.yaml
```

The flows find elements by `testID` (tabs, stats, badges, buttons) and by text. Rebuild with `npm run ios:release` after changing the app, because the tests run the installed build. Three things worth knowing:

- Each flow starts with a clean app state (`launchApp` with `clearState`), so flows are independent and can run alone.
- The Events tab shows `Totals:` and `Start order:` lines, which the flows read instead of scanning the log. They are also handy by hand.
- The `secret-looking key` warning is development only, so its flow just checks the job is enqueued. Background tasks are not covered, because iOS simulators do not support them.

The same flows can be run on a macOS runner from the Actions tab (`.github/workflows/e2e.yml`, manual only). They are not part of the automatic checks, because the shared runners are slow enough to make some timing-based flows unreliable.

## Notes

- Background tasks do not run on iOS simulators (Expo skips registering them). Use a real iPhone or an Android emulator. "Trigger now" on the Dashboard runs one immediately in development builds.
- The Lab's "Secret-looking keys" card logs a warning to the Metro console (development builds only).
- Decorators (`@queue.handler`) are not used here because they need extra Babel setup; see the docs.
- `npm run typecheck` checks the app against the library sources.
