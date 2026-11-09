import { TranslatedText, UserLoadSections, withActiveWorkspaceItems } from '@sorye/platform/react';
import { registerPendingActionFlusher } from '@sorye/platform';
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
  readCanvasQueue,
  readCanvasConflicts,
  discardCanvasConflict,
  resendPendingCanvasActions,
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
  const [queueState, setQueueState] = useState({ pending: 0, failed: 0, conflicts: 0, rejected: 0 });
  const [queuedConflicts, setQueuedConflicts] = useState<Awaited<ReturnType<typeof readCanvasConflicts>>>([]);
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
        setQueueState(data.queue);
        setQueuedConflicts(await readCanvasConflicts());
        const recovered = await resendPendingCanvasActions();
        if (!cancelled) setQueueState(recovered);
        if (!cancelled) setQueuedConflicts(await readCanvasConflicts());
        if (recovered.pending + recovered.failed === 0) {
          const refreshed = await loadBootstrap();
          if (!cancelled) { setBootstrap(refreshed); setBoards(refreshed.boards); }
        }
      } catch (err) {
        void readCanvasQueue().then(setQueueState).catch(() => undefined);
        void readCanvasConflicts().then(setQueuedConflicts).catch(() => undefined);
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

  useEffect(() => {
    const flushBestEffort = async () => {
      const state = await resendPendingCanvasActions();
      setQueueState(state);
      return state.pending + state.failed + state.conflicts + state.rejected;
    };
    const unregister = registerPendingActionFlusher('canvas', flushBestEffort);
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushBestEffort(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushBestEffort);
    window.addEventListener('sorye:logout-flush', flushBestEffort);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushBestEffort);
      window.removeEventListener('sorye:logout-flush', flushBestEffort);
      unregister();
    };
  }, []);

  const openBoard = async (boardId: string, _workspaceId?: string) => {
    setError(null);
    setBusyLabel('Opening board…');
    setLoading(true);
    try {
      const board = await loadBoard(boardId);
      setActiveBoard(board);
      setTitleDraft(board.title);
      setQueueState(await readCanvasQueue());
      setQueuedConflicts(await readCanvasConflicts());
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
      setQueueState(await readCanvasQueue());
      setQueuedConflicts(await readCanvasConflicts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      void readCanvasQueue().then(setQueueState).catch(() => undefined);
      void readCanvasConflicts().then(setQueuedConflicts).catch(() => undefined);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const next = await resendPendingCanvasActions();
    setQueueState(next);
    setQueuedConflicts(await readCanvasConflicts());
    try {
      const fresh = await loadBootstrap();
      setBootstrap(fresh); setBoards(fresh.boards);
    } catch { /* the queue state still reflects this retry */ }
  };

  const handleDelete = async (board: CanvasBoardSummary) => {
    if (!window.confirm('Delete this board for everyone in the workspace?')) return;
    setError(null);
    try {
      await deleteBoard(board.id, board.revision);
      setBoards((prev) => prev.filter((item) => item.id !== board.id));
      if (activeBoard?.id === board.id) setActiveBoard(null);
      setQueueState(await readCanvasQueue());
      setQueuedConflicts(await readCanvasConflicts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      void readCanvasQueue().then(setQueueState).catch(() => undefined);
      void readCanvasConflicts().then(setQueuedConflicts).catch(() => undefined);
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
        setError('Canvas changed elsewhere. Your attempted update remains in the local conflict queue for explicit reconciliation.');
      } else {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
      void readCanvasQueue().then(setQueueState).catch(() => undefined);
      void readCanvasConflicts().then(setQueuedConflicts).catch(() => undefined);
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
        {queueState.pending + queueState.failed + queueState.conflicts + queueState.rejected > 0 ? (
          <div className="canvas-banner" role="status">
            {queueState.pending + queueState.failed} action(s) waiting for Rodrigo; {queueState.conflicts} conflict(s); {queueState.rejected} rejected.
            {queueState.pending + queueState.failed > 0 ? <button type="button" className="btn-ghost" onClick={() => void handleResend().catch((e) => setError(String(e)))}>Resend</button> : null}
          </div>
        ) : null}
        {queuedConflicts.map((item) => (
          <details key={item.actionId} className="canvas-banner">
            <summary>{item.status} board update {item.resourceId} — copy this draft to reconcile</summary>
            <p>{item.error?.message ?? item.error?.code ?? 'Rodrigo did not accept this action.'}</p>
            <pre>{JSON.stringify(item.payload, null, 2)}</pre>
            <button type="button" className="btn-ghost" onClick={() => void discardCanvasConflict(item.actionId).then(async () => {
              setQueuedConflicts(await readCanvasConflicts()); setQueueState(await readCanvasQueue());
            })}>Discard this queued draft after reconciliation</button>
          </details>
        ))}
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

        {queueState.pending + queueState.failed + queueState.conflicts + queueState.rejected > 0 ? (
          <div className="canvas-banner" role="status">
            {queueState.pending + queueState.failed} action(s) waiting for Rodrigo; {queueState.conflicts} conflict(s); {queueState.rejected} rejected.
            {queueState.pending + queueState.failed > 0 ? <button type="button" className="btn-ghost" onClick={() => void handleResend().catch((e) => setError(String(e)))}>Resend</button> : null}
          </div>
        ) : null}
        {queuedConflicts.map((item) => (
          <details key={item.actionId} className="canvas-banner">
            <summary>{item.status} board update {item.resourceId} — copy this draft to reconcile</summary>
            <p>{item.error?.message ?? item.error?.code ?? 'Rodrigo did not accept this action.'}</p>
            <pre>{JSON.stringify(item.payload, null, 2)}</pre>
            <button type="button" className="btn-ghost" onClick={() => void discardCanvasConflict(item.actionId).then(async () => {
              setQueuedConflicts(await readCanvasConflicts()); setQueueState(await readCanvasQueue());
            })}>Discard this queued draft after reconciliation</button>
          </details>
        ))}

        {bootstrap?.load ? (
          <UserLoadSections
            load={withActiveWorkspaceItems(bootstrap.load, bootstrap.workspace.id, boards)}
            empty="No boards in this workspace."
            heading="h3"
            renderItems={(items) => (
              <div className="board-grid">
                {items.map((item) => (
                  <article key={`${item.workspaceId}:${item.value.id}`} className="board-card">
                    <button
                      type="button"
                      className="board-card-open"
                      onClick={() => void openBoard(item.value.id, item.workspaceId)}
                      disabled={loading}
                    >
                      <div className="board-thumb" aria-hidden />
                      <strong>{item.value.title}</strong>
                      <span>
                        {item.value.itemCount} items · updated {formatWhen(item.value.updatedAt)}
                      </span>
                    </button>
                  </article>
                ))}
              </div>
            )}
          />
        ) : null}
        {!bootstrap?.load && boards.length === 0 ? (
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
        ) : !bootstrap?.load ? (
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
                  onClick={() => void handleDelete(board)}
                  disabled={loading}
                >
                  <TranslatedText message="delete" />
                </button>
              </article>
            ))}
          </div>
        ) : null}
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
