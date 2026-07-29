import type { CanvasBoard, CanvasPresenceUser } from '@sorye/types';

export type CanvasRealtimeEvent =
  | {
      type: 'board-updated';
      board: CanvasBoard;
      byUserId: string;
    }
  | {
      type: 'presence';
      users: CanvasPresenceUser[];
    }
  | {
      type: 'board-deleted';
      boardId: string;
      byUserId: string;
    };

type Subscriber = (event: CanvasRealtimeEvent) => void;

const boardSubscribers = new Map<string, Set<Subscriber>>();
const presenceByBoard = new Map<string, Map<string, CanvasPresenceUser>>();
/** Users who opened the SSE stream for a board — skip DB on cursor POSTs. */
const presenceAuthorized = new Map<string, Set<string>>();

export function authorizeBoardPresence(boardId: string, userId: string): void {
  let set = presenceAuthorized.get(boardId);
  if (!set) {
    set = new Set();
    presenceAuthorized.set(boardId, set);
  }
  set.add(userId);
}

export function revokeBoardPresence(boardId: string, userId: string): void {
  const set = presenceAuthorized.get(boardId);
  if (!set) return;
  set.delete(userId);
  if (set.size === 0) presenceAuthorized.delete(boardId);
}

export function isBoardPresenceAuthorized(
  boardId: string,
  userId: string,
): boolean {
  return presenceAuthorized.get(boardId)?.has(userId) ?? false;
}

export function subscribeBoard(
  boardId: string,
  subscriber: Subscriber,
): () => void {
  let set = boardSubscribers.get(boardId);
  if (!set) {
    set = new Set();
    boardSubscribers.set(boardId, set);
  }
  set.add(subscriber);
  return () => {
    set?.delete(subscriber);
    if (set && set.size === 0) boardSubscribers.delete(boardId);
  };
}

export function publishBoardEvent(
  boardId: string,
  event: CanvasRealtimeEvent,
): void {
  const set = boardSubscribers.get(boardId);
  if (!set) return;
  for (const subscriber of set) {
    try {
      subscriber(event);
    } catch {
      // ignore broken subscribers
    }
  }
}

const PRESENCE_COLORS = [
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#fb7185',
];

export function upsertPresence(
  boardId: string,
  user: Omit<CanvasPresenceUser, 'color' | 'lastSeenAt'> & {
    color?: string;
    cursor?: { x: number; y: number };
  },
  options?: { broadcast?: boolean },
): CanvasPresenceUser[] {
  let map = presenceByBoard.get(boardId);
  if (!map) {
    map = new Map();
    presenceByBoard.set(boardId, map);
  }

  const existing = map.get(user.userId);
  const nextCursor =
    user.cursor !== undefined ? user.cursor : existing?.cursor;

  // Skip no-op cursor updates (same cell) to avoid SSE storms.
  if (
    existing &&
    options?.broadcast !== false &&
    user.cursor &&
    existing.cursor &&
    Math.hypot(
      user.cursor.x - existing.cursor.x,
      user.cursor.y - existing.cursor.y,
    ) < 8
  ) {
    existing.lastSeenAt = new Date().toISOString();
    return [...map.values()];
  }

  const next: CanvasPresenceUser = {
    userId: user.userId,
    displayName: user.displayName,
    image: user.image,
    color:
      user.color ??
      existing?.color ??
      PRESENCE_COLORS[map.size % PRESENCE_COLORS.length]!,
    cursor: nextCursor,
    lastSeenAt: new Date().toISOString(),
  };
  map.set(user.userId, next);

  const cutoff = Date.now() - 30_000;
  for (const [id, entry] of map) {
    if (new Date(entry.lastSeenAt).getTime() < cutoff) map.delete(id);
  }

  const users = [...map.values()];
  if (options?.broadcast !== false) {
    publishBoardEvent(boardId, { type: 'presence', users });
  }
  return users;
}

export function removePresence(boardId: string, userId: string): void {
  const map = presenceByBoard.get(boardId);
  if (!map) return;
  map.delete(userId);
  revokeBoardPresence(boardId, userId);
  publishBoardEvent(boardId, { type: 'presence', users: [...map.values()] });
}
