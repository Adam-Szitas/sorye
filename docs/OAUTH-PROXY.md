# Hub OAuth behind a proxy

Hub owns authentication and host-only session cookies. The Docker listening address remains `HOSTNAME=0.0.0.0`; browser origins come from validated public host headers. App landing descriptions were reviewed and remain accurate: this repair changes sign-in reliability, not app capabilities.

## Evidence and limits

The workspace installs Next.js **15.5.20**, next-auth **5.0.0-beta.29**, and @auth/core **0.40.0**. Docker installs the frozen lockfile. The production image's installed versions and environment were not accessible; the available local Hub container is a development sandbox, not production.

A fresh browser login on the deployed site used `https://sorye.app/api/auth/callback/google` at Google's account chooser. After the user selected an account, the browser again landed at `https://0.0.0.0:3000/login?error=Configuration`. No captured callback was replayed; no code or cookie was read or reused.

The installed next-auth server-action implementation uses `createActionURL`, which reads forwarded headers. Its route-handler implementation instead passes the NextRequest URL to Auth.js (unless AUTH_URL/NEXTAUTH_URL overrides it). Core builds provider callback URLs and error redirects from that request URL. `trustHost: true` permits processing; it does not rewrite that URL. Hub previously exported those handlers unchanged, while its production settings forbid AUTH_URL.

Tests reproduce both an internal token-exchange `redirect_uri` and the internal Configuration error redirect from a synthetic callback whose request URL is `https://0.0.0.0:3000` despite correct public forwarding headers. The repair normalizes the URL before callbacks and middleware, and forwards normalized request headers to server actions.

This proves the URL handling defect. It does **not** prove the original production callback's underlying error, its actual token request, or that Google rejected an IP redirect. Browser tools cannot inspect a server-to-server exchange. Production Auth.js error/cause logs, deployed environment, live Traefik configuration and a fresh successful login after deployment remain unverified.

## Deployment contract

- Rebuild and deploy Hub with this change. Retain `HOSTNAME=0.0.0.0` and port 3000.
- Set runtime `AUTH_TRUST_HOST=true`. Leave both `AUTH_URL` and legacy `NEXTAUTH_URL` unset. Set `SORYE_PUBLIC_HOST` / `SORYE_ADMIN_HOST` for non-default domains. Do not use `AUTH_REDIRECT_PROXY_URL` for this deployment; it is an advanced preview-proxy feature.
- Keep Hub reachable only by the intended ingress/gateways: the repository Compose binds Hub to loopback. A containerized Traefik needs a restricted private Docker network instead. Do not publish Hub directly to an untrusted network. `AUTH_TRUST_HOST` is an operator assertion, not proxy authentication; a spoofed approved host cannot be distinguished using headers alone.
- Route exact public hostnames through TLS. Preserve the browser Host (`passHostHeader: true`) and overwrite `X-Forwarded-Host` and `X-Forwarded-Proto` with the validated public host and `https`. Existing app/admin nginx gateways already do this. Comma-separated host/protocol chains are rejected by Hub.
- At Traefik entrypoints keep `forwardedHeaders.insecure=false`. If another load balancer precedes Traefik, trust only that load balancer's actual CIDRs using `forwardedHeaders.trustedIPs`, never arbitrary clients. Verify forged forwarding headers are discarded at the public boundary. No Traefik configuration is checked into this repository; these settings must be checked on the deployment.
- Register each host's exact callback with Google, including customer, admin and login-enabled app hosts. Cookies remain host-only. A customer `/admin` destination subsequently follows the existing redirect to the admin host, which requires its own session; this change does not bridge cookies between hosts.
- Local development keeps its original HTTP host and port. Without explicit proxy trust it ignores supplied forwarding headers. Keep AUTH_URL unset to test both localhost and admin.localhost.

## Verification

Run `pnpm --filter @sorye/hub test:auth` and `pnpm --filter @sorye/hub exec tsc --noEmit --incremental false`.

The transport regression uses the installed Google OIDC provider with mocked discovery/token HTTP responses and a freshly generated PKCE verifier per flow. It checks authorization/exchange callback equality, successful destination and session issuance, token failure/error redirects on customer/admin/app hosts and local development hosts, the old internal-origin defect, middleware login redirects, POST/query/cookie preservation, healthchecks, and invalid host/scheme/trust configuration. These are deterministic tests, not real Google acceptance or live proxy-boundary tests.

After deployment, start a **fresh** login and verify success, repeat navigation, reload, and a controlled failure on each intended host. Capture the callback time and only sanitized Auth.js error type, nested cause name/code and provider HTTP status if it fails. Do not enable Auth.js debug logging or export raw HAR, request bodies, codes, tokens, cookies, client secrets or full callback URLs. Review original logs on the server privately; share only those sanitized diagnostics. Test forged forwarded headers at ingress and confirm direct untrusted access to Hub is blocked.

References: [Auth.js deployment](https://authjs.dev/getting-started/deployment), [Traefik forwarded-header trust](https://doc.traefik.io/traefik/reference/install-configuration/entrypoints/#forwarded-headers), [Traefik services / passHostHeader](https://doc.traefik.io/traefik/reference/routing-configuration/http/load-balancing/service/).
