export type AppStatus = 'available' | 'coming_soon' | 'beta';

export type AppCategory =
  | 'productivity'
  | 'analytics'
  | 'communication'
  | 'commerce'
  | 'developer'
  | 'creative';

export interface MicroFrontendConfig {
  remoteName: string;
  remoteEntry: string;
  exposedModule: string;
}

/** Host an external web app inside the Hub via iframe. */
export interface ExternalAppConfig {
  url: string;
  /** Optional title for the iframe (accessibility). */
  title?: string;
}

/** Short first-run guidance shown in the Hub picker and app pane. */
export interface AppUsageIntro {
  /** One-line “what you do here”. */
  summary: string;
  /** 2–4 concrete steps a new user should try. */
  steps: string[];
}

export interface AppCatalogEntry {
  id: string;
  name: string;
  description: string;
  usageIntro: AppUsageIntro;
  slug: string;
  category: AppCategory;
  status: AppStatus;
  icon: string;
  color: string;
  mountPath: string;
  microFrontend?: MicroFrontendConfig;
  external?: ExternalAppConfig;
  /**
   * Pinned for every workspace. Cannot be removed and does not count
   * toward the subscription app limit.
   */
  alwaysAvailable?: boolean;
}

export const APP_CATALOG: AppCatalogEntry[] = [
  {
    id: 'catalog',
    name: 'Catalog',
    description:
      'Browse every Sorye app — always on for every workspace, no plan slot.',
    usageIntro: {
      summary: 'See all apps, what they do, and open the ones you have enabled.',
      steps: [
        'Scan the catalog by category.',
        'Open an installed app from here, or add more from the App Library.',
        'Catalog itself cannot be removed — it stays on your home grid.',
      ],
    },
    slug: 'catalog',
    category: 'productivity',
    status: 'available',
    icon: 'catalog',
    color: '#818cf8',
    mountPath: '/apps/catalog',
    alwaysAvailable: true,
  },
  {
    id: 'contact',
    name: 'Contact',
    description:
      'Who Sorye is for — try Protocolio and Canvas, or get in touch.',
    usageIntro: {
      summary:
        'The product story for smaller–mid ops, plus live Protocolio and Canvas in this Hub.',
      steps: [
        'Read the offer — document templates and ops boards in one shell.',
        'Try Protocolio or Try Canvas — those open the real remotes already in Hub.',
        'Email from this page, or pick other apps from Catalog.',
      ],
    },
    slug: 'contact',
    category: 'communication',
    status: 'available',
    icon: 'contact',
    color: '#7c9cff',
    mountPath: '/apps/contact',
    alwaysAvailable: true,
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    description:
      'Workspace overview — metrics, embeds, database, and App events.',
    usageIntro: {
      summary: 'See how your workspace is doing and turn on cross-app features.',
      steps: [
        'Open Overview for activity and quick metrics.',
        'Use Embed / Database guides when connecting Sorye to your product.',
        'Turn on App events so OCR, Tasks, and Calendar can post to Messenger.',
      ],
    },
    slug: 'dashboard',
    category: 'analytics',
    status: 'available',
    icon: 'pulse',
    color: '#38bdf8',
    mountPath: '/apps/dashboard',
    microFrontend: {
      remoteName: 'dashboard',
      remoteEntry: 'http://localhost:3001/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'notes',
    name: 'Notes',
    description: 'Capture ideas, docs, and meeting notes in one place.',
    usageIntro: {
      summary: 'Keep lightweight notes that sync into workspace activity.',
      steps: [
        'Click New note and give it a title.',
        'Write in the editor — saves are automatic.',
        'With App events on, saves can show up in Messenger #events via Relay.',
      ],
    },
    slug: 'notes',
    category: 'productivity',
    status: 'available',
    icon: 'notes',
    color: '#fbbf24',
    mountPath: '/apps/notes',
    microFrontend: {
      remoteName: 'notes',
      remoteEntry: 'http://localhost:3004/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'Schedule events, meetings, and deadlines in your workspace.',
    usageIntro: {
      summary: 'Plan days and meetings; changes can notify the team via Relay.',
      steps: [
        'Pick a day on the month view.',
        'Add a title, time, and save the event.',
        'Enable App events + Relay so saves appear in Messenger #events.',
      ],
    },
    slug: 'calendar',
    category: 'productivity',
    status: 'available',
    icon: 'calendar',
    color: '#34d399',
    mountPath: '/apps/calendar',
    microFrontend: {
      remoteName: 'calendar',
      remoteEntry: 'http://localhost:3003/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'relay',
    name: 'Relay',
    description:
      'Route OCR, Protocolio, Messenger, Calendar, and Tasks to Messenger, email, and webhooks.',
    usageIntro: {
      summary: 'Decide which apps notify Messenger, email, or your webhooks.',
      steps: [
        'Turn on App events in Dashboard first.',
        'Configure → enable sources (OCR, Protocolio, Calendar, Tasks…).',
        'Add routes like OCR → Messenger #events, then Send test in Activity.',
      ],
    },
    slug: 'relay',
    category: 'communication',
    status: 'available',
    icon: 'relay',
    color: '#60a5fa',
    mountPath: '/apps/relay',
    microFrontend: {
      remoteName: 'relay',
      remoteEntry: 'http://localhost:3006/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'storefront',
    name: 'Storefront',
    description: 'Launch and manage your online shop.',
    usageIntro: {
      summary: 'Commerce storefront — coming soon to this workspace.',
      steps: [
        'Reserve a slot when it ships.',
        'You will connect products and checkout from here.',
      ],
    },
    slug: 'storefront',
    category: 'commerce',
    status: 'coming_soon',
    icon: 'store',
    color: '#f472b6',
    mountPath: '/apps/storefront',
  },
  {
    id: 'devtools',
    name: 'DevKit',
    description:
      'API explorer, embed lab, webhook simulator, and integration logs.',
    usageIntro: {
      summary: 'Try Hub APIs, embeds, and webhooks without leaving the workspace.',
      steps: [
        'Open Overview to see what you can call.',
        'Use the API / Embed tabs to probe endpoints and widgets.',
        'Fire a test webhook and check Logs for the trail.',
      ],
    },
    slug: 'devkit',
    category: 'developer',
    status: 'available',
    icon: 'code',
    color: '#a78bfa',
    mountPath: '/apps/devkit',
    microFrontend: {
      remoteName: 'devkit',
      remoteEntry: 'http://localhost:3009/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'protocolio',
    name: 'Protocolio',
    description:
      'Build PdfTemplate JSON with presets, blocks, and live PDF export.',
    usageIntro: {
      summary: 'Design a PDF template, then generate or accept OCR handoffs.',
      steps: [
        'Start from a preset or add blocks in the visual builder.',
        'Generate PDF (Hub developer bridge or your Protocolio token).',
        'Open alongside OCR — Send to Protocolio loads the layout automatically.',
      ],
    },
    slug: 'protocolio',
    category: 'developer',
    status: 'available',
    icon: 'protocolio',
    color: '#a78bfa',
    mountPath: '/apps/protocolio',
    microFrontend: {
      remoteName: 'protocolio',
      remoteEntry: 'http://localhost:3007/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'canvas',
    name: 'Canvas',
    description:
      'Collaborative Miro-style boards — sticky notes, shapes, and team editing.',
    usageIntro: {
      summary: 'Sketch ideas on a shared board with sticky notes and shapes.',
      steps: [
        'Open or create a board.',
        'Add sticky notes and shapes from the toolbar.',
        'Drag, edit, and rearrange — changes stay on the board.',
      ],
    },
    slug: 'canvas',
    category: 'creative',
    status: 'available',
    icon: 'canvas',
    color: '#fb7185',
    mountPath: '/apps/canvas',
    microFrontend: {
      remoteName: 'canvas',
      remoteEntry: 'http://localhost:3008/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Kanban boards with configurable workflow statuses.',
    usageIntro: {
      summary: 'Move work across columns you define — drag or change status.',
      steps: [
        'Add a task from the board toolbar.',
        'Drag cards between columns, or use the status control on a card.',
        'Open Statuses to rename, reorder, or add workflow columns.',
      ],
    },
    slug: 'tasks',
    category: 'productivity',
    status: 'available',
    icon: 'tasks',
    color: '#2dd4bf',
    mountPath: '/apps/tasks',
    microFrontend: {
      remoteName: 'tasks',
      remoteEntry: 'http://localhost:3005/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'messenger',
    name: 'Messenger',
    description: 'Workspace chat for text and compressed photo uploads.',
    usageIntro: {
      summary: 'Chat with the team and watch the #events feed from other apps.',
      steps: [
        'Pick a channel or open a direct message.',
        'Send text or a photo — images are compressed before upload.',
        'Open #events (with App events on) for OCR, Tasks, and Calendar updates.',
      ],
    },
    slug: 'messenger',
    category: 'communication',
    status: 'available',
    icon: 'chat',
    color: '#2dd4bf',
    mountPath: '/apps/messenger',
    microFrontend: {
      remoteName: 'messenger',
      remoteEntry: 'http://localhost:3010/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'susm',
    name: 'SUSM',
    description: 'External SUSM workspace hosted on Vercel.',
    usageIntro: {
      summary: 'Opens the SUSM product in this pane (external site).',
      steps: [
        'Use SUSM as you would in its own tab.',
        'Sign in there if the site asks for an account.',
        'Close the pane when you are done — Hub keeps your other apps.',
      ],
    },
    slug: 'susm',
    category: 'productivity',
    status: 'available',
    icon: 'susm',
    color: '#38bdf8',
    mountPath: '/apps/susm',
    external: {
      url: 'https://susm.vercel.app',
      title: 'SUSM',
    },
  },
  {
    id: 'espm',
    name: 'ESPM',
    description: 'External ESPM workspace hosted on Vercel.',
    usageIntro: {
      summary: 'Opens the ESPM product in this pane (external site).',
      steps: [
        'Work in ESPM inside the embedded frame.',
        'Sign in on that site if required.',
        'Return to Hub apps anytime from the launcher.',
      ],
    },
    slug: 'espm',
    category: 'productivity',
    status: 'available',
    icon: 'espm',
    color: '#a78bfa',
    mountPath: '/apps/espm',
    external: {
      url: 'https://espm-beta.vercel.app',
      title: 'ESPM',
    },
  },
  {
    id: 'ocr',
    name: 'OCR',
    description:
      'Upload a PDF, extract a layout matrix, and send it to Protocolio.',
    usageIntro: {
      summary: 'Turn a PDF into a table matrix, then export or hand off for PDF.',
      steps: [
        'Upload a PDF — each page is analyzed into a layout matrix.',
        'Review Show matrix; export CSV if you need a spreadsheet.',
        'Send to Protocolio to generate a PDF (open Protocolio to auto-load).',
      ],
    },
    slug: 'ocr',
    category: 'productivity',
    status: 'available',
    icon: 'ocr',
    color: '#f59e0b',
    mountPath: '/apps/ocr',
    microFrontend: {
      remoteName: 'ocr',
      remoteEntry: 'http://localhost:3011/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'studio',
    name: 'Studio',
    description:
      'Upload 3D meshes and orbit them in WebGPU. Too-much monitor kills oversized files.',
    usageIntro: {
      summary:
        'Drop GLB, FBX, STL, OBJ, USDZ, and other mesh exports — inspect from every angle.',
      steps: [
        'Upload a mesh (GLB/FBX/STL/OBJ/USDZ…). Blender .blend and native STEP need an export first.',
        'Drag to orbit, scroll to zoom, right-drag to pan. Reset view if you get lost.',
        'If Too-much trips, the GPU path shuts down — simplify or export a lighter mesh.',
      ],
    },
    slug: 'studio',
    category: 'creative',
    status: 'available',
    icon: 'studio',
    color: '#22d3ee',
    mountPath: '/apps/studio',
    microFrontend: {
      remoteName: 'studio',
      remoteEntry: 'http://localhost:3012/remoteEntry.js',
      exposedModule: './mount',
    },
  },
  {
    id: 'reports',
    name: 'Reports',
    description: 'Scheduled exports and automated reporting.',
    usageIntro: {
      summary: 'Automated reports — coming soon.',
      steps: [
        'Schedule exports once this app ships.',
        'Pair with Relay later to notify when a report is ready.',
      ],
    },
    slug: 'reports',
    category: 'analytics',
    status: 'coming_soon',
    icon: 'reports',
    color: '#818cf8',
    mountPath: '/apps/reports',
  },
];

export function isAlwaysAvailableApp(
  catalog: AppCatalogEntry[],
  appId: string,
): boolean {
  return catalog.some((app) => app.id === appId && app.alwaysAvailable === true);
}

/** Hub-native pane (Catalog, Contact) — no MF remote or iframe. */
export function isHubNativeApp(app: AppCatalogEntry): boolean {
  return (
    app.alwaysAvailable === true && !app.microFrontend && !app.external
  );
}

/** Catalog ids that every workspace receives, in catalog order. */
export function alwaysAvailableAppIds(catalog: AppCatalogEntry[]): string[] {
  return catalog.filter((app) => app.alwaysAvailable).map((app) => app.id);
}

/**
 * Selected apps plus pinned catalog apps. Pinned apps stay first (catalog order).
 */
export function withAlwaysAvailableAppIds(
  catalog: AppCatalogEntry[],
  selectedIds: string[],
): string[] {
  const selected = new Set(selectedIds);
  const ids: string[] = [];
  for (const app of catalog) {
    if (app.alwaysAvailable || selected.has(app.id)) {
      ids.push(app.id);
    }
  }
  return ids;
}

/** How many selected apps count toward the plan cap (excludes pinned). */
export function selectableAppCount(
  catalog: AppCatalogEntry[],
  selectedIds: string[],
): number {
  return selectedIds.filter((id) => !isAlwaysAvailableApp(catalog, id)).length;
}

export function getSelectedApps(
  catalog: AppCatalogEntry[],
  selectedIds: string[],
): AppCatalogEntry[] {
  const idSet = new Set(withAlwaysAvailableAppIds(catalog, selectedIds));
  return catalog.filter((app) => idSet.has(app.id));
}

export function getAppBySlug(
  catalog: AppCatalogEntry[],
  slug: string,
): AppCatalogEntry | undefined {
  return catalog.find((app) => app.slug === slug);
}

/** Hub shell: open an app in a split pane (`detail.appId`, optional `detail.side`). */
export const HUB_OPEN_APP_EVENT = 'sorye:hub:open-app';

/** Hub shell: open the App Library picker. */
export const HUB_MANAGE_APPS_EVENT = 'sorye:hub:manage-apps';
