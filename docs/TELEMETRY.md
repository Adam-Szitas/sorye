# Sentry monitoring

Sorye uses Sentry JS for low-volume, privacy-filtered front-end and Hub
fault/performance telemetry. It is disabled when the relevant DSN is empty.

## Setup

Create a Sentry project for `javascript-nextjs` (Hub) and, optionally, one for
the browser remotes. Copy each project DSN into the deployment environment:

- Hub server/edge: `SENTRY_DSN`
- Hub browser: `NEXT_PUBLIC_SENTRY_DSN`
- Vite remotes: `VITE_SENTRY_DSN`
- `*_SENTRY_ENVIRONMENT`: `development`, `staging`, or `production`
- `*_SENTRY_RELEASE`: a CI git SHA or release identifier
- `*_SENTRY_TRACES_SAMPLE_RATE`: a number from `0` to `1`; the default is `0.05`

Hub source maps are uploaded only when `SENTRY_AUTH_TOKEN` is present, along
with `SENTRY_ORG` and `SENTRY_PROJECT`. The upload is disabled otherwise.
The Sentry auth token is server-side only and must never use a
`NEXT_PUBLIC_` or `VITE_` prefix.

For local testing, copy `.env.example` values into the appropriate local
environment files, set a development DSN, run `pnpm dev`, and trigger a
rendering error or rejected request. To disable monitoring, leave the DSNs
empty and rebuild the Vite remotes.

## Coverage and limits

Hub captures unhandled server, edge, and browser exceptions plus App Router
errors. Remotes initialize through `@sorye/telemetry`, capture navigation and
resource timing where supported, failed HTTP status codes, long browser tasks
through Sentry's browser tracing integration, and React render failures. A
remote render failure is contained by its error boundary so the Hub remains
usable.

The browser can observe failed cross-origin resource requests and coarse
timings, but cannot inspect third-party app internals or response payloads
without that app's own instrumentation. Sorye does not bypass CORS or collect
cross-origin bodies. External apps such as SUSM/ESPM must configure their own
Sentry projects if their internal faults need monitoring.

## Privacy controls

Telemetry is configured with `sendDefaultPii: false`. Request bodies, cookies,
headers, file data, and user objects are removed. URLs have query keys
associated with authentication, tokens, email, files, and content filtered;
transaction/error sampling is configurable and conservative by default.
Messenger, Mail, Reports, Drive, uploaded files, and public user content are
not sent as event payloads. Review the Sentry project's retention and access
settings before enabling production DSNs.
