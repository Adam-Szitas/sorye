import {
  TASKS_LOCAL_STORAGE_KEY,
  createDefaultTasksBoard,
  type TasksBoard,
} from '@sorye/types';
import { hubApiPath } from './hub-origin';

export type { TasksBoard };

export function createDefaultBoard(): TasksBoard {
  return createDefaultTasksBoard();
}

export function createTasksStorage() {
let revision = 0;
let conflicted = false;
let queue: Promise<void> = Promise.resolve();
const conflictDraftKey = 'sorye:tasks:conflict-draft:v1';
class ApiError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(body || `Request failed (${status})`);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (init?.method === "PUT") {
    if (conflicted) throw new Error("Another session changed this document. Your draft is kept; reload before merging changes.");
    init = { ...init, body: JSON.stringify({ ...JSON.parse(String(init.body)), expectedRevision: revision }) };
  }
  const res = await fetch(hubApiPath(path), {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 409) {
    conflicted = true;
    try {
      const parsed = JSON.parse(String(init?.body)) as { board?: TasksBoard };
      if (parsed.board) localStorage.setItem(conflictDraftKey, JSON.stringify({ savedAt: new Date().toISOString(), board: parsed.board }));
    } catch { /* The in-memory board remains available if browser storage is unavailable. */ }
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    const text = typeof error.error === 'string' ? error.error : 'Could not save the workspace document.';
    throw new ApiError(res.status, text);
  }
  const data = await res.json();
  if (!Number.isInteger(data.revision)) throw new Error("Workspace response is missing a revision. Reload the app.");
  revision = data.revision;
  if (!init?.method) conflicted = false;
  return data as T;
}

function readLegacyBoard(): TasksBoard | null {
  try {
    const raw = localStorage.getItem(TASKS_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.statuses) || !Array.isArray(record.tasks)) {
      return null;
    }
    return parsed as TasksBoard;
  } catch {
    return null;
  }
}

function clearLegacyBoard() {
  try {
    localStorage.removeItem(TASKS_LOCAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function loadBoard(): Promise<TasksBoard> {
  const data = await api<{ board: TasksBoard; empty: boolean }>('/api/tasks');
  if (data.empty) {
    const legacy = readLegacyBoard();
    if (legacy) {
      const migrated = await api<{ board: TasksBoard }>('/api/tasks', {
        method: 'PUT',
        body: JSON.stringify({ board: legacy, migrate: true }),
      });
      clearLegacyBoard();
      return migrated.board;
    }
    return data.board;
  }
  clearLegacyBoard();
  return data.board;
}

async function saveBoard(board: TasksBoard): Promise<TasksBoard> {
  const saved = await api<{ board: TasksBoard }>('/api/tasks', {
    method: 'PUT',
    body: JSON.stringify({ board }),
  });
  clearLegacyBoard();
  clearConflictDraft();
  return saved.board;
}

function readConflictDraft(): TasksBoard | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(conflictDraftKey) ?? 'null') as { board?: unknown } | null;
    if (parsed?.board && typeof parsed.board === 'object') return parsed.board as TasksBoard;
  } catch { /* ignore invalid local draft */ }
  return null;
}

function clearConflictDraft() {
  try { localStorage.removeItem(conflictDraftKey); } catch { /* ignore */ }
}

function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

function api<T>(path: string, init?: RequestInit): Promise<T> {
  const run = queue.then(() => request<T>(path, init));
  queue = run.then(() => undefined, () => undefined);
  return run;
}

return { loadBoard, saveBoard, readConflictDraft, clearConflictDraft, isConflict };
}
