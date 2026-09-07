import { loc, type LocatorSpec, type QueryRoot } from './query';

/**
 * ESPM login wall. espm-beta uses “Username”; myespm.eu uses “User name”.
 *
 * Edit these constants to retarget fields. `loc()` prefers `role`/`name`;
 * remove those keys to fall back to `css`.
 */
export const EspmLogin = {
  heading: {
    text: /sign in to your workspace/i,
    css: 'h1, h2, [class*="login"]',
  },
  username: {
    role: 'textbox' as const,
    name: /^(Username|User name)$/i,
    css: 'input[name="username"], input[name="userName"], input[autocomplete="username"]',
  },
  password: {
    role: 'textbox' as const,
    name: /^Password$/i,
    css: 'input[type="password"], input[name="password"]',
  },
  submit: {
    role: 'button' as const,
    name: /^(Sign in|Log in)/i,
    css: 'button[type="submit"], input[type="submit"]',
  },
  rememberMe: {
    role: 'checkbox' as const,
    name: /remember me/i,
    css: 'input[type="checkbox"][name*="remember" i], input[type="checkbox"]#rememberMe',
  },
  forgotPassword: {
    role: 'link' as const,
    name: /forgot password/i,
    css: 'a[href*="forgot"], a[href*="reset"]',
  },
  error: {
    text: /invalid|incorrect|failed|required|error/i,
    css: '[role="alert"], .error, .validation-message',
  },
} as const satisfies Record<string, LocatorSpec>;

export function espmLogin(root: QueryRoot) {
  return {
    heading: loc(root, EspmLogin.heading),
    username: loc(root, EspmLogin.username),
    password: loc(root, EspmLogin.password),
    submit: loc(root, EspmLogin.submit),
    rememberMe: loc(root, EspmLogin.rememberMe),
    forgotPassword: loc(root, EspmLogin.forgotPassword),
    error: loc(root, EspmLogin.error),
  };
}

export const EspmBoot = {
  loader: { css: '#espm-boot-loader, [class*="boot-loader"]' },
  loadingText: { text: 'Loading…' },
} as const satisfies Record<string, LocatorSpec>;

export const EspmApp = {
  listNav: { role: 'link' as const, name: /^(Works?|Orders|Customers|Todo)$/i },
  table: { role: 'table' as const },
  list: { role: 'list' as const },
  listHeading: { role: 'heading' as const, name: /works?|orders|customers|todo/i },
  create: { role: 'button' as const, name: /^(New|Add|Create)/i },
  dialog: { role: 'dialog' as const },
  createHeading: { role: 'heading' as const, name: /new|create|add/i },
  dataRow: { role: 'row' as const },
} as const satisfies Record<string, LocatorSpec>;
