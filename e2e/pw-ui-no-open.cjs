'use strict';

/**
 * Playwright UI (`--ui-host` / `--ui-port`) calls `open(url)`, which on Windows
 * becomes the default browser — often Cursor Simple Browser / IDE Chromium.
 * Playwright UI is a single WebSocket client, so that tab steals Run.
 *
 * Loaded via `node -r e2e/pw-ui-no-open.cjs` from `pnpm test:e2e:ui`.
 * Stubs Playwright's bundled `open` unless `PW_TEST_UI_NO_OPEN=0`.
 *
 * Playwright 1.63 exports `open` as a getter-only property on `utilsBundle`.
 * Assigning `exported.open = …` throws and kills UI startup — wrap with a Proxy.
 */
const Module = require('module');

const flag = process.env.PW_TEST_UI_NO_OPEN;
const stub =
  flag !== '0' && flag !== 'false' && flag !== 'no';

function noOpen(url) {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    console.log('');
    console.log('Playwright UI is ready. Do not open Cursor Simple Browser / IDE Chromium.');
    console.log(`In system Chrome or Edge:\n  ${url}`);
    console.log('');
  }
  return Promise.resolve();
}

function stubOpen(exported) {
  if (exported == null) return exported;
  if (typeof exported === 'function') return noOpen;
  if (typeof exported !== 'object') return exported;

  try {
    if (typeof exported.open === 'function') {
      exported.open = noOpen;
      return exported;
    }
  } catch {
    // getter-only export (Playwright 1.63+ utilsBundle)
  }

  return new Proxy(exported, {
    get(target, prop, receiver) {
      if (prop === 'open') return noOpen;
      return Reflect.get(target, prop, receiver);
    },
  });
}

if (stub) {
  const origLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const exported = origLoad.apply(this, arguments);
    const id = String(request).replace(/\\/g, '/');
    if (id === 'open' || id === './utilsBundle' || /\/utilsBundle(?:\.js)?$/.test(id)) {
      return stubOpen(exported);
    }
    return exported;
  };
}
