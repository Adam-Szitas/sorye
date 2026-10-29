import { NOTES_LOCAL_STORAGE_KEY, type Note } from '@sorye/types';

export type { Note };

export function createNotesStorage() {
let revision = 0;
let conflicted = false;
let queue: Promise<void> = Promise.resolve();
const conflictDraftKey = 'sorye:notes:conflict-draft:v1';
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
  const res = await fetch(path, {
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
      const parsed = JSON.parse(String(init?.body)) as { notes?: Note[] };
      if (parsed.notes) localStorage.setItem(conflictDraftKey, JSON.stringify({ savedAt: new Date().toISOString(), notes: parsed.notes }));
    } catch { /* The in-memory notes remain available if browser storage is unavailable. */ }
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

function readLegacyNotes(): Note[] | null {
  try {
    const raw = localStorage.getItem(NOTES_LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as Note[];
  } catch {
    return null;
  }
}

function clearLegacyNotes() {
  try {
    localStorage.removeItem(NOTES_LOCAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function loadNotes(): Promise<Note[]> {
  const data = await api<{ notes: Note[]; empty: boolean }>('/api/notes');
  if (data.empty) {
    const legacy = readLegacyNotes();
    if (legacy && legacy.length > 0) {
      const migrated = await api<{ notes: Note[] }>('/api/notes', {
        method: 'PUT',
        body: JSON.stringify({ notes: legacy, migrate: true }),
      });
      clearLegacyNotes();
      return migrated.notes;
    }
    return data.notes;
  }
  clearLegacyNotes();
  return data.notes;
}

async function saveNotes(notes: Note[]): Promise<Note[]> {
  const saved = await api<{ notes: Note[] }>('/api/notes', {
    method: 'PUT',
    body: JSON.stringify({ notes }),
  });
  clearLegacyNotes();
  clearConflictDraft();
  return saved.notes;
}

function readConflictDraft(): Note[] | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(conflictDraftKey) ?? 'null') as { notes?: unknown } | null;
    if (Array.isArray(parsed?.notes)) return parsed.notes as Note[];
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

return { loadNotes, saveNotes, readConflictDraft, clearConflictDraft, isConflict };
}
