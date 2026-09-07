import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');

/** Load gitignored env files. Does not override vars already set in the shell. Never logs values. */
export function loadE2eEnv(): void {
  const e2eEnv = path.join(root, 'e2e', '.env');
  const rootEnv = path.join(root, '.env');
  if (existsSync(e2eEnv) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(e2eEnv);
  }
  if (existsSync(rootEnv) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(rootEnv);
  }
}

loadE2eEnv();

export const DEFAULT_HUB_URL = 'http://localhost:3000';
/** SUSM has no sibling repo on this machine; keep it off ESPM's Angular :4200. */
export const DEFAULT_SUSM_URL = 'http://localhost:4201';
/** Local ESPM Angular app: `D:\MyESPM\ESPM` → `npm start` / `ng serve`. */
export const DEFAULT_ESPM_URL = 'http://localhost:4200';

export const HUB_START_HINT = 'From D:\\projects\\sorye:  pnpm dev';
export const SUSM_START_HINT =
  'Start your SUSM app on port 4201 (no SUSM repo under D:\\projects, D:\\MyESPM, or D:\\git). Example: ng serve --port 4201   or set SUSM_URL.';
export const ESPM_START_HINT =
  'From D:\\MyESPM\\ESPM:  npm start    (Angular ng serve → http://localhost:4200)';

function stripSlash(url: string): string {
  return url.replace(/\/$/, '');
}

export function allowLiveE2E(): boolean {
  const raw = process.env.ALLOW_LIVE_E2E?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function htmlSnippet(url: string): string | null {
  try {
    return execFileSync(
      process.execPath,
      [
        '-e',
        `fetch(${JSON.stringify(url)},{redirect:'follow',signal:AbortSignal.timeout(1500)}).then(async r=>process.stdout.write((await r.text()).slice(0,6000))).catch(()=>process.exit(1))`,
      ],
      { encoding: 'utf8', timeout: 2500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return null;
  }
}

export function hubLooksUp(hub: string): boolean {
  return htmlSnippet(hub) !== null;
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
  return stripSlash(fromEnv || fallback);
}

/** Resolved once per process. Specs `test.use({ baseURL })` so UI “all apps” still hits the right host. */
export const hubURL = resolveUrl('HUB_URL', DEFAULT_HUB_URL);
export const susmURL = resolveUrl('SUSM_URL', DEFAULT_SUSM_URL);
export const espmURL = resolveUrl('ESPM_URL', DEFAULT_ESPM_URL);

rejectLiveUnlessAllowed('HUB_URL', hubURL);
rejectLiveUnlessAllowed('SUSM_URL', susmURL);
rejectLiveUnlessAllowed('ESPM_URL', espmURL);

process.env.HUB_URL = hubURL;
process.env.SUSM_URL = susmURL;
process.env.ESPM_URL = espmURL;

export function requireAppReachable(kind: 'hub' | 'susm' | 'espm'): void {
  const meta = {
    hub: { name: 'Hub', url: hubURL, hint: HUB_START_HINT },
    susm: { name: 'SUSM', url: susmURL, hint: SUSM_START_HINT },
    espm: { name: 'ESPM', url: espmURL, hint: ESPM_START_HINT },
  }[kind];

  if (htmlSnippet(meta.url) !== null) return;

  if (isLocalUrl(meta.url)) {
    throw new Error(
      `${meta.name} is not running at ${meta.url}. Start the local app first: ${meta.hint}`,
    );
  }

  throw new Error(
    `${meta.name} at ${meta.url} is not reachable (ALLOW_LIVE_E2E is on).`,
  );
}
