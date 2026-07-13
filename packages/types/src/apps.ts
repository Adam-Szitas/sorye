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
}

export const APP_CATALOG: AppCatalogEntry[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    description: 'Overview of metrics, activity, and connected data sources.',
    slug: 'dashboard',
    category: 'analytics',
    status: 'available',
    icon: 'pulse',
    color: '#38bdf8',
    mountPath: '/apps/dashboard',
    microFrontend: {
      remoteName: 'dashboard',
      remoteEntry: 'http://localhost:3001/remoteEntry.js',
      exposedModule: './App',
    },
  },
  {
    id: 'notes',
    name: 'Notes',
    description: 'Capture ideas, docs, and meeting notes in one place.',
    slug: 'notes',
    category: 'productivity',
    status: 'coming_soon',
    icon: 'notes',
    color: '#fbbf24',
    mountPath: '/apps/notes',
  },
  {
    id: 'inbox',
    name: 'Inbox',
    description: 'Unified messaging across channels.',
    slug: 'inbox',
    category: 'communication',
    status: 'coming_soon',
    icon: 'inbox',
    color: '#60a5fa',
    mountPath: '/apps/inbox',
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
    description: 'API explorer, webhooks, and integration logs.',
    slug: 'devkit',
    category: 'developer',
    status: 'coming_soon',
    icon: 'code',
    color: '#a78bfa',
    mountPath: '/apps/devkit',
  },
  {
    id: 'canvas',
    name: 'Canvas',
    description: 'Design boards, wireframes, and creative assets.',
    slug: 'canvas',
    category: 'creative',
    status: 'coming_soon',
    icon: 'canvas',
    color: '#fb7185',
    mountPath: '/apps/canvas',
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'Kanban boards and sprint planning.',
    slug: 'tasks',
    category: 'productivity',
    status: 'coming_soon',
    icon: 'tasks',
    color: '#2dd4bf',
    mountPath: '/apps/tasks',
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
