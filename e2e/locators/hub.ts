import type { Page } from '@playwright/test';
import { loc, type LocatorSpec } from './query';

/**
 * Hub login wall (`/login`). There is no email/password form — only Google
 * OAuth or the local AUTH_DEV_BYPASS button.
 *
 * Edit `role` / `name` (or drop them and use `css`) if the login copy changes.
 */
export const HubLogin = {
  headingLocal: {
    role: 'heading' as const,
    name: 'Local Hub',
    css: 'h1',
  },
  headingGoogle: {
    role: 'heading' as const,
    name: 'Sign in to Sorye',
    css: 'h1',
  },
  continueLocally: {
    role: 'button' as const,
    name: 'Continue locally',
    css: 'form button[type="submit"]',
  },
  continueWithGoogle: {
    role: 'button' as const,
    name: 'Continue with Google',
    css: 'form button[type="submit"]',
  },
  error: {
    role: 'alert' as const,
    css: '[role="alert"]',
  },
  googleHint: {
    text: /AUTH_GOOGLE_ID/,
  },
} as const satisfies Record<string, LocatorSpec>;

export function hubLogin(page: Page) {
  return {
    headingLocal: loc(page, HubLogin.headingLocal),
    headingGoogle: loc(page, HubLogin.headingGoogle),
    continueLocally: loc(page, HubLogin.continueLocally),
    continueWithGoogle: loc(page, HubLogin.continueWithGoogle),
    error: loc(page, HubLogin.error),
    googleHint: loc(page, HubLogin.googleHint),
  };
}

export const HubChrome = {
  footerTime: { css: 'footer time' },
  signOut: { role: 'button' as const, name: 'Sign out' },
  notifications: { role: 'button' as const, name: /Notifications/ },
  connections: { role: 'button' as const, name: 'Connections' },
} as const satisfies Record<string, LocatorSpec>;

export const HubLauncher = {
  welcome: { role: 'heading' as const, name: 'Welcome to your workspace' },
  manageApps: { role: 'button' as const, name: 'Manage apps' },
  mainNav: { role: 'navigation' as const, name: 'Main navigation' },
} as const satisfies Record<string, LocatorSpec>;

export function hubOpenApp(appName: string): LocatorSpec {
  return { role: 'button', name: `Open ${appName}`, exact: true };
}

export function hubOpenAppOnLeft(appName: string): LocatorSpec {
  return { role: 'button', name: `Open ${appName} on the left` };
}

export function hubPane(appName: string): LocatorSpec {
  return { role: 'region', name: `${appName} (left)` };
}

export function hubUsageGuide(appName: string): LocatorSpec {
  return { role: 'complementary', name: `How to use ${appName}` };
}

export const HubUsageGuide = {
  gotIt: { role: 'button' as const, name: 'Got it' },
} as const satisfies Record<string, LocatorSpec>;

export const HubManageApps = {
  heading: { role: 'heading' as const, name: 'App Library' },
  alwaysIncluded: { text: 'Catalog and Contact are always included and free.' },
  done: { role: 'button' as const, name: 'Done' },
  row: { role: 'listitem' as const },
  rowToggle: { role: 'button' as const },
} as const satisfies Record<string, LocatorSpec>;

export function hubManageAppsRowName(appName: string): LocatorSpec {
  return { text: appName, exact: true };
}

export const HubCatalog = {
  heading: { role: 'heading' as const, name: 'App catalog' },
  manageEnabled: { role: 'button' as const, name: 'Manage enabled apps' },
  open: { role: 'button' as const, name: 'Open' },
  row: { role: 'listitem' as const },
} as const satisfies Record<string, LocatorSpec>;

export const HubContact = {
  heading: { role: 'heading' as const, name: 'Sorye' },
  tryProtocolio: { role: 'button' as const, name: 'Try Protocolio' },
  tryCanvas: { role: 'button' as const, name: 'Try Canvas' },
  topBar: { role: 'button' as const, name: 'Contact', exact: true },
  dock: { role: 'button' as const, name: 'Contact app' },
} as const satisfies Record<string, LocatorSpec>;

export const HubRemote = {
  loading: { text: 'Loading app…' },
  loadFailed: { text: /Failed to load micro-frontend/ },
  unavailable: { text: 'This app is not available on your workspace.' },
} as const satisfies Record<string, LocatorSpec>;

export function hubRemoteHeading(heading: string): LocatorSpec {
  return { role: 'heading', name: heading, exact: true };
}

export function hubAppIframeCss(appName: string): string {
  return `iframe[title="${appName}"]`;
}

export const HubEmbed = {
  susmLoadError: { text: /Could not load SUSM in the Hub frame/ },
  espmLoadError: { text: /Could not load ESPM in the Hub frame/ },
} as const satisfies Record<string, LocatorSpec>;

export const HubDashboard = {
  nav: { role: 'navigation' as const, name: 'Dashboard sections' },
  workspaceOverview: { role: 'button' as const, name: 'Workspace overview' },
  installedApps: { role: 'heading' as const, name: 'Installed apps' },
} as const satisfies Record<string, LocatorSpec>;

export const HubStudio = {
  uploadModel: { role: 'button' as const, name: 'Upload model' },
  samplePart: { role: 'button' as const, name: 'Sample part' },
  warming: { text: 'Warming WebGPU…' },
  webgpuBlocked: { text: /No WebGPU|WebGPU failed/i },
  tris: { text: /tris/ },
  heading: { role: 'heading' as const, name: 'Studio' },
} as const satisfies Record<string, LocatorSpec>;

export const HubOcr = {
  uploadPdf: { role: 'button' as const, name: 'Upload PDF' },
  layoutMatrix: { role: 'heading' as const, name: 'Layout matrix' },
  empty: { text: 'No document yet.' },
} as const satisfies Record<string, LocatorSpec>;
