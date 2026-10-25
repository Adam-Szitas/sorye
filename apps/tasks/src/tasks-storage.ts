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

class ApiError extends Error {
  status: number;

  constructor(status: number, body: string) {
    super(body || `Request failed (${status})`);
    this.status = status;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(hubApiPath(path), {
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

export async function loadBoard(): Promise<TasksBoard> {
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

export async function saveBoard(board: TasksBoard): Promise<TasksBoard> {
  const saved = await api<{ board: TasksBoard }>('/api/tasks', {
    method: 'PUT',
    body: JSON.stringify({ board }),
  });
  clearLegacyBoard();
  return saved.board;
}
