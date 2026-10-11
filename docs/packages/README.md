# Public package guides

The public release contains five packages. Keep their versions aligned and use
the root entry point for the common path. Import specialist APIs from the
subpaths documented in each guide.

- [Core](core.md): schemas, contracts, resource definitions, and intent compilation.
- [Runtime](runtime.md): application composition, evaluation, data, regions, results, and actions.
- [Web](web.md): browser app, component registration, recipes, and component subpaths.
- [React](react.md): provider, region, hooks, family wrappers, and server rendering.
- [Agent](agent.md): app tool endpoint, protocol adapters, sessions, and model transports.

These Markdown files are the source for each published npm `README.md`.
Release staging copies them into clean package archives. Keep API examples in
sync with the tarball consumer tests.
