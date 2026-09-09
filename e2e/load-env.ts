import { execFileSync } from "node:child_process";
import dns from "node:dns";
import { existsSync } from "node:fs";
import path from "node:path";

try {
  dns.setDefaultResultOrder("ipv6first");
} catch {
  /* Node <17 */
}

const root = path.resolve(__dirname, "..");

/** Load gitignored env files. Does not override vars already set in the shell. Never logs values. */
export function loadE2eEnv(): void {
  const e2eEnv = path.join(root, "e2e", ".env");
  const rootEnv = path.join(root, ".env");
  if (existsSync(e2eEnv) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(e2eEnv);
  }
  if (existsSync(rootEnv) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(rootEnv);
  }
}

loadE2eEnv();

export const DEFAULT_HUB_URL = "http://localhost:3000";
/** Local SUSM Angular app: `D:\Martina\app\susm` → `ng serve` (default :4200). Never Vercel. */
export const DEFAULT_SUSM_URL = "https://susm.vercel.app";
/** When ESPM already owns :4200, start SUSM with `ng serve --port 4201`. */
export const SUSM_ALT_URL = "http://localhost:4201";
/** Local ESPM Angular app: `D:\MyESPM\ESPM` → `npm start` / `ng serve`. */
export const DEFAULT_ESPM_URL = "https://espm-beta.vercel.app";

export const HUB_START_HINT = "From D:\\projects\\sorye:  pnpm dev";
export const SUSM_START_HINT =
  'From D:\\Martina\\app\\susm:  ng serve    → http://localhost:4200 (use localhost, not 127.0.0.1). If ESPM already uses :4200:  ng serve --port 4201   then  $env:SUSM_URL="http://localhost:4201"';
export const ESPM_START_HINT =
  "From D:\\MyESPM\\ESPM:  npm start    (Angular ng serve → http://localhost:4200)";

function stripSlash(url: string): string {
  return url.replace(/\/$/, "");
}

/** Windows `ng serve` often binds [::1] only — 127.0.0.1 fails, localhost works. */
function preferLocalhostHost(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1") {
      parsed.hostname = "localhost";
      return stripSlash(parsed.href);
    }
  } catch {
    return url;
  }
  return url;
}

export function allowLiveE2E(): boolean {
  const raw = process.env.ALLOW_LIVE_E2E?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function probeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Playwright workers inject NODE_OPTIONS (--require loaders). A nested `node -e`
  // that inherits them exits immediately, so reachability looks like “app down”.
  delete env.NODE_OPTIONS;
  return env;
}

/** Probe script: prefer IPv6 localhost (Windows ng serve binds [::1] only). */
function probeScript(url: string): string {
  return `
const dns = require('node:dns');
const http = require('node:http');
try { dns.setDefaultResultOrder('ipv6first'); } catch {}
const target = ${JSON.stringify(url)};
function viaFetch() {
  return fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(2000) })
    .then(async (r) => Buffer.from(await r.arrayBuffer()).subarray(0, 6000).toString('utf8'));
}
function getLoopback(path, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: '::1',
      family: 6,
      port,
      path,
      headers: { Host: 'localhost:' + port },
      timeout: 2000,
    }, (res) => {
      const loc = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
        const next = new URL(loc, target);
        const nextPort = Number(next.port || port);
        getLoopback((next.pathname || '/') + next.search, nextPort).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).subarray(0, 6000).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}
function viaIpv6Loopback() {
  const u = new URL(target);
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    return Promise.reject(new Error('not-loopback'));
  }
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  return getLoopback((u.pathname || '/') + u.search, port);
}
viaFetch().catch(() => viaIpv6Loopback())
  .then((t) => process.stdout.write(t))
  .catch(() => process.exit(1));
`;
}

function htmlSnippet(url: string): string | null {
  try {
    return execFileSync(process.execPath, ["-e", probeScript(url)], {
      encoding: "utf8",
      timeout: 4000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: probeEnv(),
    });
  } catch {
    return null;
  }
}

export function hubLooksUp(hub: string): boolean {
  return htmlSnippet(hub) !== null;
}

function looksLikeSusm(html: string | null): boolean {
  if (!html) return false;
  return (
    /<title>\s*Susm\s*<\/title>/i.test(html) ||
    /\bsusm\.svg\b/i.test(html) ||
    /login-form__title/i.test(html) ||
    /class="login-form"/i.test(html)
  );
}

function rejectLiveUnlessAllowed(name: string, url: string): void {
  if (isLocalUrl(url)) return;
  if (allowLiveE2E()) return;
  throw new Error(
    `${name} must be a localhost URL (got ${url}). Start the local app, or set ALLOW_LIVE_E2E=true only if you intend to hit a remote host.`,
  );
}

function resolveUrl(envKey: string, fallback: string): string {
  const fromEnv = process.env[envKey]?.trim();
  return preferLocalhostHost(stripSlash(fromEnv || fallback));
}

/**
 * Prefer an explicit `SUSM_URL`. Otherwise pick a local process that looks like SUSM
 * (`ng serve` default :4200, or :4201 when ESPM already owns :4200). Never Vercel.
 */
function resolveSusmUrl(): string {
  const fromEnv = process.env.SUSM_URL?.trim();
  if (fromEnv) return preferLocalhostHost(stripSlash(fromEnv));

  const onAlt = htmlSnippet(SUSM_ALT_URL);
  if (looksLikeSusm(onAlt)) return SUSM_ALT_URL;

  const onDefault = htmlSnippet(DEFAULT_SUSM_URL);
  if (looksLikeSusm(onDefault)) return DEFAULT_SUSM_URL;

  // :4200 is up but it is not SUSM (usually ESPM) — keep the SUSM project off that host.
  if (onDefault) return SUSM_ALT_URL;

  return DEFAULT_SUSM_URL;
}

/** Resolved once per process. Specs `test.use({ baseURL })` so UI “all apps” still hits the right host. */
export const hubURL = resolveUrl("HUB_URL", DEFAULT_HUB_URL);
export const susmURL = resolveSusmUrl();
export const espmURL = resolveUrl("ESPM_URL", DEFAULT_ESPM_URL);

rejectLiveUnlessAllowed("HUB_URL", hubURL);
rejectLiveUnlessAllowed("SUSM_URL", susmURL);
rejectLiveUnlessAllowed("ESPM_URL", espmURL);

process.env.HUB_URL = hubURL;
process.env.SUSM_URL = susmURL;
process.env.ESPM_URL = espmURL;

if (
  process.env.E2E_PRINT_TARGETS === "1" &&
  process.env.TEST_WORKER_INDEX == null
) {
  console.log("e2e URLs (localhost, not Vercel):");
  console.log(`  Hub  ${hubURL}`);
  console.log(`  SUSM ${susmURL}`);
  console.log(`  ESPM ${espmURL}`);
}

function envHint(kind: "hub" | "susm" | "espm", url: string): string {
  const envKey = { hub: "HUB_URL", susm: "SUSM_URL", espm: "ESPM_URL" }[kind];
  return [
    `${kind === "hub" ? "Hub" : kind === "susm" ? "SUSM" : "ESPM"} is not running at ${url}.`,
    `Start the local app first: ${
      kind === "hub"
        ? HUB_START_HINT
        : kind === "susm"
          ? SUSM_START_HINT
          : ESPM_START_HINT
    }`,
    "",
    `If it is already running on another localhost port:`,
    `  PowerShell:  $env:${envKey}="http://localhost:<port>"`,
    `  then:        pnpm test:e2e -- --project=${kind}`,
    `               pnpm test:e2e:headed`,
    "",
    "Use http://localhost (not http://127.0.0.1). Windows ng serve often listens on [::1] only.",
  ].join("\n");
}

export function requireAppReachable(kind: "hub" | "susm" | "espm"): void {
  const meta = {
    hub: { name: "Hub", url: hubURL, hint: HUB_START_HINT },
    susm: { name: "SUSM", url: susmURL, hint: SUSM_START_HINT },
    espm: { name: "ESPM", url: espmURL, hint: ESPM_START_HINT },
  }[kind];

  if (htmlSnippet(meta.url) !== null) return;

  if (isLocalUrl(meta.url)) {
    throw new Error(envHint(kind, meta.url));
  }

  throw new Error(
    `${meta.name} at ${meta.url} is not reachable (ALLOW_LIVE_E2E is on).`,
  );
}
