import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.PLAYWRIGHT_UI_HOST ?? '127.0.0.1';
const port = process.env.PLAYWRIGHT_UI_PORT ?? '9323';
const url = `http://${host}:${port}`;
const uiConfig = 'playwright.config.ts';
const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const noOpenHook = path.join(root, 'e2e', 'pw-ui-no-open.cjs');

const extra = process.argv.slice(2).filter((arg, i, arr) => {
  if (arg === '--project' || arg.startsWith('--project=')) return false;
  if (i > 0 && arr[i - 1] === '--project') return false;
  return true;
});

function portBusy(listenHost, listenPort) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: listenHost, port: Number(listenPort) }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function printBanner() {
  console.log('');
  console.log('Playwright UI (single client — Cursor must not own this tab)');
  console.log(`  ${url}`);
  console.log('');
  console.log('1. Close any Cursor Simple Browser / IDE Chromium tab on this port.');
  console.log('2. Open that URL in system Chrome or Edge (not Cursor).');
  console.log('3. Press Run there. Tests open Playwright-owned Chromium, not Cursor.');
  console.log('');
  console.log('If Run is greyed / tests already ran in Cursor:');
  console.log('  close the Cursor tab on this port → Ctrl+C this command → pnpm test:e2e:ui');
  console.log('  then open the URL in Chrome again.');
  console.log('');
  console.log('Port in use?  $env:PLAYWRIGHT_UI_PORT="9324"   then  pnpm test:e2e:ui');
  console.log('No UI server (watch a Chromium window only):  pnpm test:e2e:headed');
  console.log('');
  console.log('Sorye Hub tests use http://localhost:3000. Start them with pnpm dev.');
  console.log('');
  console.log('In Playwright UI, choose a Hub test or press Run all (F5).');
  console.log('');
}

async function main() {
  printBanner();

  if (await portBusy(host, port)) {
    console.error(`Playwright UI port ${port} is already in use (${url}).`);
    console.error('Close the other UI tab/process, or pick a free port:');
    console.error('  $env:PLAYWRIGHT_UI_PORT="9324"');
    console.error('  pnpm test:e2e:ui');
    console.error('Skip UI Mode (visible Chromium only):  pnpm test:e2e:headed');
    process.exit(1);
  }

  const listed = spawnSync(process.execPath, [cli, 'test', '--list', '-c', uiConfig], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  });

  if (listed.stdout) process.stdout.write(listed.stdout);
  if (listed.stderr) process.stderr.write(listed.stderr);
  if (listed.status) {
    console.error(
      'Could not list tests. Is @playwright/test installed? Is HUB_URL localhost (or ALLOW_LIVE_E2E=true)?',
    );
    process.exit(listed.status);
  }

  const child = spawn(
    process.execPath,
    [
      '-r',
      noOpenHook,
      cli,
      'test',
      '--ui',
      `--ui-host=${host}`,
      `--ui-port=${port}`,
      '-c',
      uiConfig,
      ...extra,
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PW_TEST_UI_NO_OPEN: '1' },
      windowsHide: false,
    },
  );

  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1));
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
