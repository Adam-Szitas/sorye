import type {
  CanvasBoard,
  CanvasBoardSummary,
  CanvasDocument,
  CanvasPresenceUser,
} from '@sorye/types';

export interface CanvasBootstrap {
  workspace: { id: string; kind: 'personal' | 'team'; name: string };
  user: { id: string; displayName: string; image?: string };
  boards: CanvasBoardSummary[];
}

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(body || `Request failed (${status})`);
    this.status = status;
    this.body = body;
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

export function loadBootstrap() {
  return api<CanvasBootstrap>('/api/canvas/boards');
}

export function createBoard(title: string) {
  return api<CanvasBoard>('/api/canvas/boards', {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function loadBoard(boardId: string) {
  return api<CanvasBoard>(`/api/canvas/boards/${boardId}`);
}

export function saveBoard(
  boardId: string,
  patch: {
    title?: string;
    document?: CanvasDocument;
    expectedRevision?: number;
  },
) {
  return api<CanvasBoard>(`/api/canvas/boards/${boardId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteBoard(boardId: string) {
  return api<{ ok: boolean }>(`/api/canvas/boards/${boardId}`, {
    method: 'DELETE',
  });
}

export function postPresence(
  boardId: string,
  cursor?: { x: number; y: number },
) {
  return api<{ users: CanvasPresenceUser[] }>(
    `/api/canvas/boards/${boardId}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ cursor }),
    },
  );
}

export type BoardEvent =
  | { type: 'board-updated'; board: CanvasBoard; byUserId: string }
  | { type: 'presence'; users: CanvasPresenceUser[] }
  | { type: 'board-deleted'; boardId: string; byUserId: string };

export function subscribeBoardEvents(
  boardId: string,
  onEvent: (event: BoardEvent) => void,
): () => void {
  const source = new EventSource(`/api/canvas/boards/${boardId}/events`, {
    withCredentials: true,
  });

  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as BoardEvent);
    } catch {
      // ignore malformed
    }
  };

  return () => source.close();
}
