# Public site monitoring boundary

The static Varendo site ships `browser-monitoring.json` and
`google-analytics.json` with `enabled: false`. Local development, previews,
documentation examples, package consumers, and non-HTTPS origins do not request
or initialize either integration. A production host can mount a replacement
configuration only for the Varendo documentation host, `hermawan22.github.io`.

## Same-origin telemetry

When enabled, the browser sends at most ten best-effort same-origin OTLP JSON
requests: a page count, up to five supported numeric performance observations,
one navigation span, and at most three error counts. The request has omitted
credentials, no referrer, same-origin mode, rejected redirects, no retries, and
no durable queue. It never serializes a URL, query string, hash, referrer, DOM
content, form value, exception text, user identity, or persistent session ID.

The static image does not provide an OTLP receiver. The deployment owner must
separately configure the same-origin `/otel/v1/metrics` and `/otel/v1/traces`
routes with size, rate, and attribute limits. Source tests prove client payload
boundaries, not collector operation or production observability.

## Optional Google Analytics

Google Analytics remains disabled unless deployment configuration supplies a
valid measurement ID. On the public HTTPS site, a visitor must choose Allow
before its script loads. The event uses only origin and pathname, excludes query
and fragment values, disables Google Signals and ad personalization, and sets
client storage to `none`. Declining leaves it off; the local consent value is a
non-identifying preference used solely to avoid repeatedly asking.

The static server's CSP permits only the necessary Google script and collection
origins. That allowance does not enable the integration by itself.

GitHub Pages serves static documentation and has no OTLP receiver. Monitoring and analytics configurations are disabled by default; keep monitoring disabled on Pages. A separately approved self-hosted deployment must supply its own collector and consent configuration before enabling uploads.
