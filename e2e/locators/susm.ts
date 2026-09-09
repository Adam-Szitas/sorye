import { loc, type LocatorSpec, type QueryRoot } from './query';

/**
 * Local SUSM (`D:\Martina\app\susm`) login wall.
 *
 * Guest `/` redirects to `/projects` then `/login?returnUrl=…`. Copy is i18n
 * from the backend (`login.title` = “Log In” / DE “Anmelden”). If translations
 * fail, ngx-translate renders the key. Names below match EN, DE, and keys.
 *
 * Tweak `role` / `name` / `label` (or drop them and use `css`) here —
 * specs and `loginSusm()` read these constants.
 */
export const SUSM_LOGIN_URL = /\/login(?:\?|$|#)/;

export const SusmLogin = {
  heading: {
    role: 'heading' as const,
    name: /^(Log In|Login|Anmelden|login\.title)$/i,
    css: 'h1.login-form__title, .login-form__title',
  },
  email: {
    label: /^(E-mail address|E-Mail-Adresse|E-mail|Email|login\.email)$/i,
    css: 'input#email, input[type="email"][name="email"]',
  },
  password: {
    label: /^(Password|Passwort|login\.password)$/i,
    css: 'input#current-password, input[type="password"][name="password"]',
  },
  submit: {
    role: 'button' as const,
    name: /^(Log In|Login|Anmelden|login\.title)$/i,
    css: 'button.login-form__submit, form.login-form button[type="submit"]',
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
    text: /invalid|incorrect|failed|required|anmelden/i,
    css: '.login-error, [role="alert"], .error, .form-error',
  },
  nav: {
    role: 'navigation' as const,
    name: 'Main',
    css: 'nav.app-nav, nav[aria-label="Main"]',
  },
  brand: {
    role: 'link' as const,
    name: 'SUSM',
    css: 'a.navbar-brand, .login-form__brand',
  },
  form: {
    css: 'form.login-form',
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
    form: loc(root, SusmLogin.form),
  };
}

export const SusmNav = {
  main: { role: 'navigation' as const, name: 'Main' },
  projects: { role: 'link' as const, name: /^(Projects|Projekte|navbar\.projects)$/i },
  logout: { role: 'button' as const, name: /^(Logout|Abmelden|navbar\.logout)$/i },
} as const satisfies Record<string, LocatorSpec>;

export const SusmProjects = {
  heading: { role: 'heading' as const, name: /^(Projects|Projekte|projects\.title)$/i },
  addNew: { role: 'button' as const, name: /^(Add new project|Neues Projekt|projects\.addNew)$/i },
  firstTitle: { css: 'main h2' },
  dialog: { role: 'dialog' as const },
  projectHeading: { role: 'heading' as const, name: /project|projekt/i },
} as const satisfies Record<string, LocatorSpec>;
