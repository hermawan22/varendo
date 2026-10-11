# @varendo/testkit

Bounded helpers for testing Varendo host integrations. The package consumes the
public runtime result-stream and result-store types; it does not create a
second authorization or materialization implementation.

`@varendo/testkit` is Apache-2.0 source in this repository, but it is an
internal workspace (`private: true`), not a public npm artifact. It may be
packed and installed by local security/consumer tests to verify its boundary.
The package overview is maintained here in `docs/testing/testkit.md`.
