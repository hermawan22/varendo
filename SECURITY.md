# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/hermawan22/varendo/security/advisories/new). Do not post exploit details, credentials, customer records, or active incident information in a public issue.

Include the affected exact package version and entry point, a minimal synthetic reproduction, expected and observed behavior, and the practical impact. Remove secrets and unrelated private data.

## Security boundary

Varendo validates typed contracts and proposals. The integrating application remains responsible for authenticated identity, authorization, private data access, routes, and business actions. Browser payloads, selected records, model output, and protocol calls never establish authority by themselves.

Keep provider and data-source credentials out of browser bundles, Results, exports, logs, and examples. Recheck authorization before committing an asynchronous presentation change or performing a business effect.
