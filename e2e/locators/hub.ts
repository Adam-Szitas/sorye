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
  appGrid: { role: 'button' as const, name: /App grid/ },
  backToHub: { role: 'link' as const, name: /^(← Hub|Back to Hub)$/ },
  closeAll: { role: 'button' as const, name: 'Close all' },
  resizePanes: { role: 'separator' as const, name: 'Resize panes' },
} as const satisfies Record<string, LocatorSpec>;

export const HubDock = {
  home: { role: 'button' as const, name: 'Home' },
  apps: { role: 'button' as const, name: 'Apps' },
  connect: { role: 'button' as const, name: 'Connect' },
  split: { role: 'button' as const, name: 'Open split workspace' },
} as const satisfies Record<string, LocatorSpec>;

export const HubLauncher = {
  welcome: { role: 'heading' as const, name: 'Welcome to your workspace' },
  manageApps: { role: 'button' as const, name: 'Manage apps' },
  mainNav: { role: 'navigation' as const, name: 'Main navigation' },
} as const satisfies Record<string, LocatorSpec>;

export function hubOpenApp(appName: string): LocatorSpec {
  // Unread badges append ", N unread notifications" to the aria-label.
  return {
    role: 'button',
    name: new RegExp(`^Open ${escapeRegExp(appName)}(?:$|,)`),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hubOpenAppOnLeft(appName: string): LocatorSpec {
  return { role: 'button', name: `Open ${appName} on the left` };
}

export function hubOpenAppOnRight(appName: string): LocatorSpec {
  return { role: 'button', name: `Open ${appName} on the right` };
}

export function hubPane(
  appName: string,
  side: 'left' | 'right' = 'left',
): LocatorSpec {
  return { role: 'region', name: `${appName} (${side})` };
}

export function hubUsageGuide(appName: string): LocatorSpec {
  return { role: 'complementary', name: `How to use ${appName}` };
}

export const HubUsageGuide = {
  gotIt: { role: 'button' as const, name: 'Got it' },
} as const satisfies Record<string, LocatorSpec>;

export const HubManageApps = {
  heading: { role: 'heading' as const, name: 'App Library' },
  alwaysIncluded: { text: 'Catalog is always included and free.' },
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
  email: { role: 'button' as const, name: 'Email', exact: true },
  emailDialog: { role: 'heading' as const, name: 'Email Sorye' },
  emailModal: { role: 'dialog' as const, name: 'Email Sorye' },
  to: { label: 'To' },
  subject: { label: 'Subject' },
  yourName: { label: 'Your name' },
  yourEmail: { label: 'Your email' },
  company: { label: 'Company' },
  whatYouNeed: { label: 'What you need' },
  close: { role: 'button' as const, name: 'Close' },
  send: { role: 'button' as const, name: 'Send' },
  loginLink: { role: 'link' as const, name: 'Contact' },
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
  appEvents: { role: 'button' as const, name: 'App events' },
  appEventsHeading: { role: 'heading' as const, name: 'App events' },
  installedApps: { role: 'heading' as const, name: 'Installed apps' },
  /** Feature flag switch — name toggles between “App events on/off”. */
  appEventsSwitch: { role: 'switch' as const, name: /App events (on|off)/ },
  appEventsEnabledMessage: {
    text: /App events enabled\. Open Messenger/,
  },
} as const satisfies Record<string, LocatorSpec>;

export const HubRelay = {
  heading: { role: 'heading' as const, name: 'Relay' },
  configureTab: { role: 'tab' as const, name: 'Configure' },
  activityTab: { role: 'tab' as const, name: 'Activity' },
  appSources: { role: 'heading' as const, name: 'App sources' },
  deliveryChannels: { role: 'heading' as const, name: 'Delivery channels' },
  routingRules: { role: 'heading' as const, name: 'Routing rules' },
  addRoute: { role: 'button' as const, name: 'Add route' },
  routeOn: { role: 'checkbox' as const, name: 'On' },
  sourceTasks: { role: 'checkbox' as const, name: /Tasks/ },
  messengerChannelEnabled: {
    role: 'checkbox' as const,
    name: 'Enabled',
  },
  savedNotice: { text: /Relay routes saved/ },
  sendTest: { role: 'button' as const, name: /Send test|Sending/ },
} as const satisfies Record<string, LocatorSpec>;

export function hubRelayRouteRow(sourceLabel: string): LocatorSpec {
  return { css: `li.route-row:has(strong:text-is("${sourceLabel}"))` };
}

export const HubTasks = {
  heading: { role: 'heading' as const, name: 'Tasks' },
  newTask: { label: 'New task' },
  addTask: { role: 'button' as const, name: 'Add task' },
  boardTab: { role: 'tab' as const, name: 'Board' },
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

export const HubMail = {
  heading: { role: 'heading' as const, name: 'Mail', exact: true },
  loading: { text: 'Loading Mail…' },
  compose: { role: 'button' as const, name: 'Compose' },
  composeDialog: { role: 'dialog' as const, name: 'Compose Sorye Mail' },
  composeHeading: { role: 'heading' as const, name: 'Compose Sorye Mail' },
  to: { label: 'To' },
  subject: { label: 'Subject' },
  message: { label: 'Message' },
  send: { role: 'button' as const, name: 'Send' },
  cancel: { role: 'button' as const, name: 'Cancel' },
  close: { role: 'button' as const, name: 'Close' },
  inbox: { role: 'button' as const, name: /^Inbox/ },
  sent: { role: 'button' as const, name: /^Sent/ },
} as const satisfies Record<string, LocatorSpec>;

export const HubMessenger = {
  heading: { role: 'heading' as const, name: 'Messenger' },
  loading: { text: 'Loading Messenger…' },
  composer: { placeholder: /Message|Direct message|Comment on an event/ },
  send: { role: 'button' as const, name: 'Send', exact: true },
  forwardToMail: { role: 'button' as const, name: 'Forward to Mail' },
  /** Public #events feed (channel name is “events”; # is aria-hidden). */
  eventsChannel: { role: 'button' as const, name: /^events/ },
  conversation: { role: 'region' as const, name: 'Conversation' },
  channelsHeading: { role: 'heading' as const, name: 'Channels' },
  sendTestEvent: { role: 'button' as const, name: 'Send test event' },
  eventsLive: { text: /Events live/ },
} as const satisfies Record<string, LocatorSpec>;

export const HubDrive = {
  heading: { role: 'heading' as const, name: 'Drive' },
  loading: { text: 'Loading Drive…' },
  upload: { css: 'input[type="file"]' },
  search: { label: 'Search' },
  open: { role: 'button' as const, name: 'Open', exact: true },
  previewClose: { role: 'button' as const, name: 'Close' },
  previewLoading: { text: 'Loading preview…' },
} as const satisfies Record<string, LocatorSpec>;

export function hubDriveFile(name: string): LocatorSpec {
  return { role: 'button', name, exact: true };
}

export function hubDrivePreview(name: string): LocatorSpec {
  return { role: 'dialog', name };
}

export const HubStorefront = {
  heading: { role: 'heading' as const, name: 'Storefront' },
  addToCart: { role: 'button' as const, name: 'Add to cart' },
  cart: { role: 'button' as const, name: /^Cart/ },
  shop: { role: 'button' as const, name: 'Shop', exact: true },
  orders: { role: 'button' as const, name: 'My orders' },
  placeOrder: { role: 'button' as const, name: 'Place order request' },
  addedNotice: { text: /Added .+ to cart/ },
  placedNotice: { text: /Order request .+ saved for this workspace/ },
} as const satisfies Record<string, LocatorSpec>;

export const HubSite = {
  heading: { role: 'heading' as const, name: 'Site' },
  loading: { text: 'Loading…' },
  pageTitle: { label: 'Page title' },
  addSection: { role: 'button' as const, name: 'Add section' },
  published: { label: 'Published' },
} as const satisfies Record<string, LocatorSpec>;

export const HubReports = {
  heading: { role: 'heading' as const, name: 'Reports' },
  loading: { text: 'Loading charts…' },
  forbidden: { text: 'Reports is limited to workspace admins.' },
  empty: { role: 'heading' as const, name: 'No events in this range' },
  volume: { role: 'heading' as const, name: /Event volume/ },
  volumeChart: { role: 'img' as const, name: /Event volume/ },
} as const satisfies Record<string, LocatorSpec>;

export const HubNotifications = {
  heading: { role: 'heading' as const, name: 'Notifications' },
  center: { role: 'complementary' as const, name: 'Notification center' },
  close: { role: 'button' as const, name: 'Close', exact: true },
  closeBackdrop: { role: 'button' as const, name: 'Close notification center' },
  toastPopups: { text: 'Toast popups' },
  toast: { role: 'status' as const },
  empty: { text: /No notifications yet/ },
  markAllRead: { role: 'button' as const, name: 'Mark all read' },
} as const satisfies Record<string, LocatorSpec>;

export function hubNotificationTitle(title: string | RegExp): LocatorSpec {
  return { text: title };
}
