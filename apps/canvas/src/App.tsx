import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CanvasBoard,
  CanvasBoardSummary,
  CanvasDocument,
  CanvasPresenceUser,
} from '@sorye/types';
import { emptyCanvasDocument } from '@sorye/types';
import { BoardCanvas } from './board-canvas';
import {
  createBoard,
  deleteBoard,
  loadBoard,
  loadBootstrap,
  postPresence,
  saveBoard,
  subscribeBoardEvents,
  ApiError,
  type CanvasBootstrap,
} from './canvas-api';
import './styles.css';

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<CanvasBootstrap | null>(null);
  const [boards, setBoards] = useState<CanvasBoardSummary[]>([]);
  const [activeBoard, setActiveBoard] = useState<CanvasBoard | null>(null);
  const [presence, setPresence] = useState<CanvasPresenceUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState('Loading Canvas…');
  const [saving, setSaving] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const saveTimer = useRef<number | null>(null);
  const skipRemote = useRef(false);
  const interactingRef = useRef(false);
  const changeGenRef = useRef(0);
  const boardRef = useRef(activeBoard);
  boardRef.current = activeBoard;
  const titleDraftRef = useRef(titleDraft);
  titleDraftRef.current = titleDraft;
  const saveInFlightRef = useRef(false);
  const saveAgainRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBusyLabel('Loading boards…');
      try {
        const data = await loadBootstrap();
        if (cancelled) return;
        setBootstrap(data);
        setBoards(data.boards);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Could not load Canvas. Sign in to the hub first.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openBoard = async (boardId: string) => {
    setError(null);
    setBusyLabel('Opening board…');
    setLoading(true);
    try {
      const board = await loadBoard(boardId);
      setActiveBoard(board);
      setTitleDraft(board.title);
      setPresence([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open board');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setError(null);
    setBusyLabel('Creating board…');
    setLoading(true);
    try {
      const board = await createBoard('Untitled board');
      setBoards((prev) => [
        {
          id: board.id,
          workspaceId: board.workspaceId,
          title: board.title,
          createdBy: board.createdBy,
          updatedBy: board.updatedBy,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
          revision: board.revision,
          itemCount: 0,
        },
        ...prev,
      ]);
      setActiveBoard(board);
      setTitleDraft(board.title);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (boardId: string) => {
    if (!window.confirm('Delete this board for everyone in the workspace?')) {
      return;
    }
    try {
      await deleteBoard(boardId);
      setBoards((prev) => prev.filter((b) => b.id !== boardId));
      if (activeBoard?.id === boardId) setActiveBoard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const persistDocument = useCallback(async (title?: string) => {
    const board = boardRef.current;
    if (!board) return;

    if (saveInFlightRef.current) {
      saveAgainRef.current = true;
      return;
    }

    const genAtStart = changeGenRef.current;
    const document = board.document;
    const titleToSave =
      title !== undefined ? title : titleDraftRef.current.trim() || board.title;

    saveInFlightRef.current = true;
    setSaving(true);
    try {
      const next = await saveBoard(board.id, {
        document,
        title: titleToSave,
        expectedRevision: board.revision,
      });
      skipRemote.current = true;

      const localNewer = changeGenRef.current !== genAtStart;
      setActiveBoard((prev) => {
        if (!prev || prev.id !== next.id) return prev;
        const merged = localNewer
          ? {
              ...next,
              document: prev.document,
              title: titleDraftRef.current.trim() || next.title,
            }
          : next;
        boardRef.current = merged;
        return merged;
      });

      setBoards((prev) =>
        prev.map((b) =>
          b.id === next.id
            ? {
                ...b,
                title: localNewer
                  ? titleDraftRef.current.trim() || next.title
                  : next.title,
                updatedAt: next.updatedAt,
                updatedBy: next.updatedBy,
                revision: next.revision,
                itemCount: localNewer
                  ? (boardRef.current?.document.items.length ??
                    next.document.items.length)
                  : next.document.items.length,
              }
            : b,
        ),
      );

      if (localNewer) {
        saveAgainRef.current = true;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Conflict: only reload if the user isn't mid-edit; otherwise keep local
        // and retry after they stop so we don't wipe in-progress typing.
        if (interactingRef.current || changeGenRef.current !== genAtStart) {
          saveAgainRef.current = true;
        } else {
          const fresh = await loadBoard(board.id);
          setActiveBoard(fresh);
          setTitleDraft(fresh.title);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
      if (saveAgainRef.current) {
        saveAgainRef.current = false;
        if (!interactingRef.current) {
          window.setTimeout(() => {
            void persistDocument();
          }, 400);
        }
      }
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (interactingRef.current) return;
    saveTimer.current = window.setTimeout(() => {
      void persistDocument();
    }, 900);
  }, [persistDocument]);

  const onInteractionChange = useCallback(
    (active: boolean) => {
      interactingRef.current = active;
      if (active) {
        if (saveTimer.current) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = null;
        }
        return;
      }
      scheduleSave();
    },
    [scheduleSave],
  );

  const onDocumentChange = useCallback(
    (document: CanvasDocument) => {
      const board = boardRef.current;
      if (!board) return;
      changeGenRef.current += 1;
      const next = { ...board, document };
      boardRef.current = next;
      setActiveBoard(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const onTitleBlur = () => {
    if (!activeBoard || titleDraft.trim() === activeBoard.title) return;
    changeGenRef.current += 1;
    void persistDocument(titleDraft.trim());
  };

  useEffect(() => {
    if (!activeBoard) return;
    const stop = subscribeBoardEvents(activeBoard.id, (event) => {
      if (event.type === 'presence') {
        setPresence(event.users);
        return;
      }
      if (event.type === 'board-deleted') {
        setActiveBoard(null);
        setBoards((prev) => prev.filter((b) => b.id !== event.boardId));
        return;
      }
      if (event.type === 'board-updated') {
        if (skipRemote.current) {
          skipRemote.current = false;
          return;
        }
        if (event.byUserId === bootstrap?.user.id) return;
        // Don't clobber in-progress typing / gestures with a remote snapshot.
        if (interactingRef.current) return;
        setActiveBoard(event.board);
        setTitleDraft(event.board.title);
        setBoards((prev) =>
          prev.map((b) =>
            b.id === event.board.id
              ? {
                  ...b,
                  title: event.board.title,
                  updatedAt: event.board.updatedAt,
                  updatedBy: event.board.updatedBy,
                  revision: event.board.revision,
                  itemCount: event.board.document.items.length,
                }
              : b,
          ),
        );
      }
    });
    return stop;
  }, [activeBoard?.id, bootstrap?.user.id]);

  // Cursor sync: keep a local ref, flush at most once per 2s (never on every mousemove).
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const lastCursorSent = useRef<{ x: number; y: number } | null>(null);

  const onCursorMove = useCallback((point: { x: number; y: number } | null) => {
    cursorRef.current = point;
  }, []);

  useEffect(() => {
    if (!activeBoard) return;

    const id = window.setInterval(() => {
      const point = cursorRef.current;
      const prev = lastCursorSent.current;

      if (!point) {
        if (prev) {
          lastCursorSent.current = null;
          void postPresence(activeBoard.id, undefined).catch(() => {});
        }
        return;
      }

      const movedFar =
        !prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 40;
      if (!movedFar) return;

      lastCursorSent.current = point;
      void postPresence(activeBoard.id, point).catch(() => {});
    }, 2000);

    return () => {
      window.clearInterval(id);
      lastCursorSent.current = null;
    };
  }, [activeBoard?.id]);

  if (loading && !bootstrap) {
    return (
      <div className="canvas-app">
        <div className="canvas-loading" role="status" aria-live="polite">
          <span className="canvas-spinner" aria-hidden />
          <p>{busyLabel}</p>
        </div>
      </div>
    );
  }

  if (error && !bootstrap) {
    return (
      <div className="canvas-app">
        <div className="canvas-state error">{error}</div>
      </div>
    );
  }

  if (!activeBoard) {
    return (
      <div className="canvas-app">
        {loading ? (
          <div className="canvas-loading-overlay" role="status" aria-live="polite">
            <span className="canvas-spinner" aria-hidden />
            <p>{busyLabel}</p>
          </div>
        ) : null}
        <header className="canvas-header">
          <div>
            <h1>Canvas</h1>
            <p>
              Boards for{' '}
              <strong>{bootstrap?.workspace.name ?? 'workspace'}</strong>
              {bootstrap?.workspace.kind === 'team'
                ? ' · shared with your team'
                : ' · personal workspace'}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={handleCreate}
            disabled={loading}
          >
            New board
          </button>
        </header>

        {error ? <div className="canvas-banner">{error}</div> : null}

        {boards.length === 0 ? (
          <div className="canvas-empty">
            <h2>No boards yet</h2>
            <p>Create a board and invite teammates by switching to a team workspace.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={handleCreate}
              disabled={loading}
            >
              Create your first board
            </button>
          </div>
        ) : (
          <div className="board-grid">
            {boards.map((board) => (
              <article key={board.id} className="board-card">
                <button
                  type="button"
                  className="board-card-open"
                  onClick={() => void openBoard(board.id)}
                  disabled={loading}
                >
                  <div className="board-thumb" aria-hidden />
                  <strong>{board.title}</strong>
                  <span>
                    {board.itemCount} items · updated {formatWhen(board.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className="board-card-delete"
                  onClick={() => void handleDelete(board.id)}
                  disabled={loading}
                >
                  Delete
                </button>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="canvas-app board-open">
      {loading ? (
        <div className="canvas-loading-overlay" role="status" aria-live="polite">
          <span className="canvas-spinner" aria-hidden />
          <p>{busyLabel}</p>
        </div>
      ) : null}
      <header className="canvas-header board-bar">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            if (saveTimer.current) {
              window.clearTimeout(saveTimer.current);
              saveTimer.current = null;
            }
            interactingRef.current = false;
            void persistDocument().finally(() => {
              setActiveBoard(null);
              setPresence([]);
              void loadBootstrap()
                .then((data) => setBoards(data.boards))
                .catch(() => {});
            });
          }}
        >
          ← Boards
        </button>
        <input
          className="board-title-input"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={onTitleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          aria-label="Board title"
        />
        <div className="board-meta">
          <span className={saving ? 'saving' : 'saved'}>
            {saving ? 'Saving…' : 'Saved'}
          </span>
          <div className="presence-avatars" aria-label="People on this board">
            {presence.map((p) => (
              <span
                key={p.userId}
                className="presence-avatar"
                style={{ borderColor: p.color }}
                title={p.displayName}
              >
                {p.image ? (
                  <img src={p.image} alt="" />
                ) : (
                  p.displayName.charAt(0).toUpperCase()
                )}
              </span>
            ))}
          </div>
        </div>
      </header>

      {error ? <div className="canvas-banner">{error}</div> : null}

      <BoardCanvas
        document={activeBoard.document ?? emptyCanvasDocument()}
        presence={presence}
        currentUserId={bootstrap?.user.id ?? ''}
        onChange={onDocumentChange}
        onCursorMove={onCursorMove}
        onInteractionChange={onInteractionChange}
      />
    </div>
  );
}
