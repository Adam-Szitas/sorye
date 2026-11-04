import { execFileSync } from 'node:child_process';
import dns from 'node:dns';
import { existsSync } from 'node:fs';
import path from 'node:path';

try {
  dns.setDefaultResultOrder('ipv6first');
} catch {
  // Older Node versions do not expose this option.
}

const root = path.resolve(__dirname, '..');

// Local E2E settings never override values already set in the shell.
for (const envPath of [path.join(root, 'e2e', '.env'), path.join(root, '.env')]) {
  if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envPath);
  }
}

export const hubURL = (process.env.HUB_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');
const allowLive = ['1', 'true', 'yes'].includes(
  process.env.ALLOW_LIVE_E2E?.trim().toLowerCase() || '',
);

function isLocalUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

if (!isLocalUrl(hubURL) && !allowLive) {
  throw new Error('HUB_URL must be localhost unless ALLOW_LIVE_E2E=true.');
}

process.env.HUB_URL = hubURL;

function probeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Playwright worker loaders can break a nested Node reachability probe.
  delete env.NODE_OPTIONS;
  return env;
}

function probeScript(url: string): string {
  return `
const dns = require('node:dns');
const http = require('node:http');
try { dns.setDefaultResultOrder('ipv6first'); } catch {}
const target = ${JSON.stringify(url)};
function viaIpv6Loopback() {
  const u = new URL(target);
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
    return Promise.reject(new Error('not-loopback'));
  }
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '::1', family: 6, port, path: u.pathname + u.search,
      headers: { Host: 'localhost:' + port }, timeout: 2000 }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}
fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(2000) })
  .catch(() => viaIpv6Loopback())
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
`;
}

export function hubLooksUp(url = hubURL): boolean {
  try {
    execFileSync(process.execPath, ['-e', probeScript(url)], {
      timeout: 4000,
      windowsHide: true,
      stdio: 'ignore',
      env: probeEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

export function requireHubReachable(): void {
  if (hubLooksUp()) return;
  throw new Error(
    `Sorye Hub is not reachable at ${hubURL}. Start pnpm dev or set HUB_URL to its local address.`,
  );
}
