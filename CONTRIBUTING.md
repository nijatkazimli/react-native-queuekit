# Contributing

Thanks for helping with QueueKit. Bug reports, fixes, docs and ideas are all welcome.

## Setup

```sh
git clone https://github.com/nijatkazimli/react-native-queuekit.git
cd react-native-queuekit
npm install        # also enables the git hooks in .githooks
```

Node 22 or newer is needed.

## Checks

```sh
npm run lint            # Biome: lint + format check (npm run format fixes)
npm run typecheck
npm test                # unit and property-based tests
npm run test:coverage   # 100% coverage is enforced
npm run test:fuzz       # 5000 random operation sequences, including crashes
npm run build
```

The pre-commit hook runs lint, typecheck and the tests. The pre-push hook adds coverage and the build. CI runs the same checks.

## Making a change

- Open an issue first for anything bigger than a small fix, so we agree on the direction.
- Add or update tests. New behavior needs tests that fail without the change, and coverage must stay at 100%.
- Update the docs in `docs/` and the README when behavior or the public API changes, and keep the JSDoc in `src/types.ts` in sync.
- Keep changes focused. Please do not mix refactors with fixes.

### Commit messages

Use `type(scope): message`, for example `fix(core): clamp the wake-up timer` or `docs: explain orderKey`. Types in use: `feat`, `fix`, `perf`, `docs`, `test`, `ci`, `chore`. The release notes are generated from these subjects, so write them for the people reading the changelog.

## Project layout

```text
src/          the library (core/, platform/, react/)
test/         tests mirroring src/
docs/         documentation site (plain HTML)
examples/     copy-pasteable snippets, and examples/app, an Expo app for trying every feature
```

## Trying changes in an app

`examples/app` runs the local build of the library. See its [README](examples/app/README.md) for running it and the Maestro end-to-end tests.

## Releases

Maintainers release with `npm run release:patch` (or `minor` / `major`). The tag triggers the publish workflow, which checks, builds, publishes to npm with provenance and creates the GitHub release.

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
