import { NOTES_LOCAL_STORAGE_KEY, type Note } from '@sorye/types';

export type { Note };

class ApiError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(body || `Request failed (${status})`);
    this.status = status;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<T>;
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

export async function loadNotes(): Promise<Note[]> {
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

export async function saveNotes(notes: Note[]): Promise<Note[]> {
  const saved = await api<{ notes: Note[] }>('/api/notes', {
    method: 'PUT',
    body: JSON.stringify({ notes }),
  });
  clearLegacyNotes();
  return saved.notes;
}
