export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface DevkitLogEntry {
  id: string;
  at: string;
  kind: 'api' | 'embed' | 'webhook' | 'system';
  title: string;
  detail?: string;
  ok: boolean;
  status?: number;
  durationMs?: number;
}

export interface ApiPreset {
  id: string;
  label: string;
  method: HttpMethod;
  path: string;
  body?: string;
  note?: string;
}

const LOG_KEY = 'sorye:devkit:logs';

export const API_PRESETS: ApiPreset[] = [
  {
    id: 'workspace',
    label: 'GET workspace session',
    method: 'GET',
    path: '/api/workspace',
    note: 'Requires hub session cookie',
  },
  {
    id: 'embed-widgets',
    label: 'GET embed widgets',
    method: 'GET',
    path: '/api/embed/widgets',
  },
  {
    id: 'canvas-boards',
    label: 'GET canvas boards',
    method: 'GET',
    path: '/api/canvas/boards',
  },
  {
    id: 'embed-bootstrap',
    label: 'POST embed bootstrap',
    method: 'POST',
    path: '/api/embed/bootstrap',
    body: JSON.stringify(
      {
        key: 'sk_embed_…',
        origin: 'http://localhost:5173',
        app: 'notes',
      },
      null,
      2,
    ),
    note: 'Public endpoint — key + origin allowlist',
  },
  {
    id: 'workspace-patch',
    label: 'PATCH workspace name (dry example)',
    method: 'PATCH',
    path: '/api/workspace',
    body: JSON.stringify({ name: 'Personal' }, null, 2),
    note: 'Edit carefully — mutates workspace',
  },
];

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadLogs(): DevkitLogEntry[] {
  return safeParse<DevkitLogEntry[]>(localStorage.getItem(LOG_KEY), []);
}

export function saveLogs(entries: DevkitLogEntry[]) {
  localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(0, 80)));
}

export function appendLog(
  entry: Omit<DevkitLogEntry, 'id' | 'at'>,
): DevkitLogEntry[] {
  const next: DevkitLogEntry = {
    ...entry,
    id: `log-${crypto.randomUUID().slice(0, 8)}`,
    at: new Date().toISOString(),
  };
  const logs = [next, ...loadLogs()].slice(0, 80);
  saveLogs(logs);
  return logs;
}

export function clearLogs() {
  localStorage.removeItem(LOG_KEY);
}

export function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function runHubRequest(input: {
  method: HttpMethod;
  path: string;
  body?: string;
}): Promise<{
  ok: boolean;
  status: number;
  durationMs: number;
  headers: Record<string, string>;
  bodyText: string;
  bodyJson: unknown | null;
}> {
  const started = performance.now();
  const init: RequestInit = {
    method: input.method,
    credentials: 'include',
    headers: {},
  };

  if (input.body && input.method !== 'GET') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = input.body;
  }

  const res = await fetch(input.path, init);
  const durationMs = Math.round(performance.now() - started);
  const bodyText = await res.text();
  let bodyJson: unknown | null = null;
  try {
    bodyJson = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    bodyJson = null;
  }

  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    ok: res.ok,
    status: res.status,
    durationMs,
    headers,
    bodyText,
    bodyJson,
  };
}
