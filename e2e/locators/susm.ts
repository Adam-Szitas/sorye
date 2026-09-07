import { loc, type LocatorSpec, type QueryRoot } from './query';

/**
 * SUSM login wall. Tweak `role` / `name` (or drop them and use `css`) here —
 * specs and `loginSusm()` read these constants.
 */
export const SusmLogin = {
  heading: {
    role: 'heading' as const,
    name: 'Log In',
    css: 'h1, h2',
  },
  email: {
    role: 'textbox' as const,
    name: 'E-mail address',
    css: 'input[type="email"], input[name="email"], input[name="username"]',
  },
  password: {
    role: 'textbox' as const,
    name: 'Password',
    css: 'input[type="password"]',
  },
  submit: {
    role: 'button' as const,
    name: 'Log In',
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
    text: /invalid|incorrect|failed|required/i,
    css: '[role="alert"], .error, .form-error',
  },
  nav: {
    role: 'navigation' as const,
    name: 'Main',
  },
  brand: {
    role: 'link' as const,
    name: 'SUSM',
  },
} as const satisfies Record<string, LocatorSpec>;

export function susmLogin(root: QueryRoot) {
  return {
    heading: loc(root, SusmLogin.heading),
    email: loc(root, SusmLogin.email),
    password: loc(root, SusmLogin.password),
    submit: loc(root, SusmLogin.submit),
    rememberMe: loc(root, SusmLogin.rememberMe),
    forgotPassword: loc(root, SusmLogin.forgotPassword),
    error: loc(root, SusmLogin.error),
    nav: loc(root, SusmLogin.nav),
    brand: loc(root, SusmLogin.brand),
  };
}

export const SusmNav = {
  main: { role: 'navigation' as const, name: 'Main' },
  projects: { role: 'link' as const, name: 'Projects' },
  logout: { role: 'button' as const, name: 'Logout' },
} as const satisfies Record<string, LocatorSpec>;

export const SusmProjects = {
  heading: { role: 'heading' as const, name: 'Projects' },
  addNew: { role: 'button' as const, name: 'Add new project' },
  firstTitle: { css: 'main h2' },
  dialog: { role: 'dialog' as const },
  projectHeading: { role: 'heading' as const, name: /project/i },
} as const satisfies Record<string, LocatorSpec>;
