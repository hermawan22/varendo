# Security package boundary proof

`testkit-consumer.mjs` builds public `@varendo/core` and `@varendo/runtime`, plus internal Apache-2.0 `@varendo/testkit` (`private: true`), then packs those local artifacts into a temporary directory outside the pnpm workspace and compiles a strict TypeScript consumer with `skipLibCheck: false`. The testkit tarball is a local boundary probe, not a public-release claim.

The installed runtime probe exercises result-store revocation clearing and the installed testkit exports for default collection, overflow cleanup, abort cleanup and synchronous iterator failure cleanup. It checks full Apache license bytes, package-lock integrity, artifact hashes, absence of workspace aliases and installed symlinks, plus source commit and candidate digest stability. The run writes a report and copied package lock under `artifacts/security-testkit-consumers/`.

Run it with Node 24.20.0:

```sh
node tests/security/testkit-consumer.mjs
```
