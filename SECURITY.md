# Security policy

## Supported versions

Security fixes are released for the latest `1.x` version of `@nijatk/react-native-queuekit`. Please update before reporting.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private reporting instead: open the [Security tab](https://github.com/nijatkazimli/react-native-queuekit/security/advisories/new) of this repository and choose **Report a vulnerability**. Include the version, a minimal way to reproduce the problem and what you think the impact is.

You can expect an acknowledgement within a few days. Once a fix is released, the advisory is published and you are credited if you want to be.

## What to keep in mind when using QueueKit

QueueKit stores job payloads in the storage you give it. Reading the docs on [secrets and tokens](https://nijatkazimli.github.io/react-native-queuekit/storage.html#secrets) before putting anything private in a payload is worth the two minutes:

- Payloads are saved as plain JSON unless your storage is encrypted (for example MMKV with an `encryptionKey`).
- Prefer reading tokens inside the handler instead of putting them in the payload.
- `sensitive: true` keeps a payload out of event listeners and logs. It does not encrypt anything.
- `maxPayloadBytes` limits the size of payloads (64 KB by default).

These are documented behaviors, not vulnerabilities. A way to bypass `sensitive`, `maxPayloadBytes` or the documented storage guarantees would be.
