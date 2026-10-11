# Next.js SSR and hydration example

This App Router fixture server-renders a trusted Lit template through the built
web package, then imports hydration support before element registration. Its
client host accepts typed input proposals and owns form state. HTML inserted by
the host comes from the trusted renderer's escaped output.

Run `pnpm test:next-platform` from the repository root. The separate Lit
hydration fixture covers pre-upgrade draft and focus preservation.

This import order follows [Lit client hydration documentation](https://lit.dev/docs/ssr/client-usage/).
The server package isolation uses [Next serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).
These upstream mechanisms still require the actual fixture tests to pass.
