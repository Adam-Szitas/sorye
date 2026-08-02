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

export interface AppCatalogEntry {
  id: string;
  name: string;
  description: string;
  slug: string;
  category: AppCategory;
  status: AppStatus;
  icon: string;
  color: string;
  mountPath: string;
  microFrontend?: MicroFrontendConfig;
  external?: ExternalAppConfig;
}

export const APP_CATALOG: AppCatalogEntry[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    description:
      'Connect Sorye apps to your product, plus workspace metrics and activity.',
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
      'Route messages from your workspace apps to email, WhatsApp, and webhooks.',
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
      'Build Protocolio PdfTemplate JSON with presets, blocks, and live export.',
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
    description:
      'Workspace chat for text and compressed photo uploads.',
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
    id: 'reports',
    name: 'Reports',
    description: 'Scheduled exports and automated reporting.',
    slug: 'reports',
    category: 'analytics',
    status: 'coming_soon',
    icon: 'reports',
    color: '#818cf8',
    mountPath: '/apps/reports',
  },
];

export function getSelectedApps(
  catalog: AppCatalogEntry[],
  selectedIds: string[],
): AppCatalogEntry[] {
  const idSet = new Set(selectedIds);
  return catalog.filter((app) => idSet.has(app.id));
}

export function getAppBySlug(
  catalog: AppCatalogEntry[],
  slug: string,
): AppCatalogEntry | undefined {
  return catalog.find((app) => app.slug === slug);
}
