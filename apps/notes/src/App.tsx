import { TranslatedText, UserLoadSections, withActiveWorkspaceItems } from '@sorye/platform/react';
import { registerPendingActionFlusher, switchAuthorizedWorkspace } from '@sorye/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserLoadPartition } from '@sorye/types';
import { createNotesStorage, type Note } from './notes-storage';
import { emitWorkspaceEvent } from './emit-event';
import './styles.css';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function App() {
  const storage = useMemo(() => createNotesStorage(), []);
  const { loadSnapshot, saveNotes } = storage;
  const [notes, setNotes] = useState<Note[]>([]);
  const [partition, setPartition] = useState<UserLoadPartition<Note> | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictDraftAvailable, setConflictDraftAvailable] = useState(false);
  const [queueStatus, setQueueStatus] = useState({ pending: 0, failed: 0, conflicts: 0, rejected: 0 });
  const emitTimer = useRef<number | null>(null);
  const persistTimer = useRef<number | null>(null);
  const pendingNotes = useRef<Note[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSnapshot()
      .then((next) => {
        if (cancelled) return;
        setNotes(next.notes);
        setPartition(next.load ?? null);
        setWorkspaceId(next.workspace?.id ?? null);
        setActiveId(next.notes[0]?.id ?? null);
        setLoadState('ready');
        void storage.queueState().then(setQueueStatus).catch(() => undefined);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState('error');
          void storage.queueState().then(setQueueStatus).catch(() => undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => { if (emitTimer.current) window.clearTimeout(emitTimer.current); }, []);

  useEffect(() => {
    const flushBestEffort = async () => {
      await storage.resendPending().catch(() => undefined);
      const state = await storage.queueState().catch(() => ({ pending: 1, failed: 0, conflicts: 0, rejected: 0 }));
      return state.pending + state.failed + state.conflicts + state.rejected;
    };
    const unregister = registerPendingActionFlusher('notes', flushBestEffort);
    const refreshPending = () => { void storage.queueState().then(setQueueStatus).catch(() => undefined); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushBestEffort(); else refreshPending(); };
    window.addEventListener('pagehide', flushBestEffort);
    window.addEventListener('sorye:logout-flush', flushBestEffort);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushBestEffort);
      window.removeEventListener('sorye:logout-flush', flushBestEffort);
      document.removeEventListener('visibilitychange', onVisibility);
      unregister();
    };
  }, [storage]);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeId) ?? null,
    [notes, activeId],
  );
  const listed = useMemo(
    () => (partition && workspaceId ? withActiveWorkspaceItems(partition, workspaceId, notes) : null),
    [partition, workspaceId, notes],
  );

  const openListed = async (itemWorkspaceId: string, noteId: string) => {
    if (!workspaceId || itemWorkspaceId === workspaceId) {
      setActiveId(noteId);
      return;
    }
    const switched = await switchAuthorizedWorkspace(itemWorkspaceId);
    if (!switched) {
      setSaveError('Could not open that workspace.');
      return;
    }
    const next = await loadSnapshot();
    setNotes(next.notes);
    setPartition(next.load ?? null);
    setWorkspaceId(next.workspace?.id ?? null);
    setActiveId(noteId);
  };

  const persist = useCallback((next: Note[], _immediate = false) => {
    setNotes(next);
    // Save immediately: saveNotes durably queues action IDs before its first network send.
    void saveNotes(next).then(
        () => { setSaveError(null); setConflictDraftAvailable(false); return storage.queueState(); },
        (err: unknown) => {
          setSaveError(err instanceof Error ? err.message : 'Could not save to the workspace.');
          setConflictDraftAvailable(Boolean(storage.readConflictDraft()));
          return storage.queueState();
        },
      ).then(setQueueStatus).catch(() => undefined);
  }, [saveNotes, storage]);

  const resendPending = async () => {
    try {
      await storage.resendPending();
      const latest = await loadSnapshot();
      setNotes(latest.notes); setPartition(latest.load ?? null); setWorkspaceId(latest.workspace?.id ?? null);
      setActiveId((current) => latest.notes.some((note) => note.id === current) ? current : latest.notes[0]?.id ?? null);
      setSaveError(null);
    }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Rodrigo has not confirmed the pending notes.'); }
    setQueueStatus(await storage.queueState().catch(() => queueStatus));
  };

  const downloadConflictDraft = () => {
    const draft = storage.readConflictDraft();
    if (!draft) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sorye-notes-conflict-draft.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const discardDraftAndReload = async () => {
    try {
      await storage.discardConflictsAndRejected();
      const latest = await loadSnapshot();
      storage.clearConflictDraft();
      setNotes(latest.notes);
      setPartition(latest.load ?? null);
      setWorkspaceId(latest.workspace?.id ?? null);
      setActiveId(latest.notes[0]?.id ?? null);
      setConflictDraftAvailable(false);
      setSaveError(null);
      setQueueStatus(await storage.queueState());
    } catch {
      setSaveError('Could not reload the latest notes. Your draft is still available in this browser.');
    }
  };

  const scheduleNoteEvent = useCallback((note: Note) => {
    if (emitTimer.current) window.clearTimeout(emitTimer.current);
    emitTimer.current = window.setTimeout(() => {
      void emitWorkspaceEvent('sorye.notes.saved', {
        title: `Note saved: ${note.title || 'Untitled'}`,
        appId: 'notes',
        entityId: note.id,
      });
    }, 800);
  }, []);

  const createNote = () => {
    const note: Note = {
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      title: 'Untitled note',
      body: '',
      updatedAt: new Date().toISOString(),
    };
    const next = [note, ...notes];
    persist(next, true);
    setActiveId(note.id);
    void emitWorkspaceEvent('sorye.notes.saved', {
      title: 'Note created',
      appId: 'notes',
      entityId: note.id,
    });
  };

  const updateActive = (patch: Partial<Pick<Note, 'title' | 'body'>>) => {
    if (!activeNote) return;
    const updated = {
      ...activeNote,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const next = notes.map((n) => (n.id === activeNote.id ? updated : n));
    persist(next);
    scheduleNoteEvent(updated);
  };

  const deleteActive = () => {
    if (!activeNote) return;
    const next = notes.filter((n) => n.id !== activeNote.id);
    persist(next, true);
    setActiveId(next[0]?.id ?? null);
  };

  return (
    <div className="notes-app">
      {loadState === 'loading' ? (
        <p className="notes-empty">Loading workspace notes…</p>
      ) : null}
      {loadState === 'error' ? (
        <p className="notes-empty" role="alert">
          Could not load notes from the workspace.
        </p>
      ) : null}
      {saveError ? (
        <div className="notes-empty" role="alert">
          {saveError}
          {conflictDraftAvailable ? <div className="notes-list-toolbar">
            <button type="button" className="btn-ghost" onClick={downloadConflictDraft}>Download my draft</button>
            <button type="button" className="btn-ghost" onClick={() => void discardDraftAndReload()}>Discard draft and load latest</button>
          </div> : null}
        </div>
      ) : null}
      {queueStatus.pending + queueStatus.failed + queueStatus.conflicts + queueStatus.rejected > 0 ? (
        <div className="notes-empty" role="status">
          {queueStatus.pending + queueStatus.failed} note action(s) await Rodrigo; {queueStatus.conflicts} conflict(s); {queueStatus.rejected} rejected.
          {queueStatus.pending + queueStatus.failed > 0 ? <button type="button" className="btn-ghost" onClick={() => void resendPending()}>Resend</button> : null}
        </div>
      ) : null}

      {loadState === 'ready' ? (
        <div className="notes-layout">
          <section className="notes-panel notes-list-panel">
            <div className="notes-list-toolbar">
              <h2>All notes</h2>
              <button type="button" className="btn-primary btn-sm" onClick={createNote}>
                New
              </button>
            </div>

            {listed ? (
              <UserLoadSections
                load={listed}
                empty="No notes in this workspace."
                heading="h3"
                renderItems={(items) => (
                  <ul className="notes-list">
                    {items.map((item) => (
                      <li key={`${item.workspaceId}:${item.value.id}`}>
                        <button
                          type="button"
                          className={item.value.id === activeId && item.workspaceId === workspaceId ? 'active' : undefined}
                          onClick={() => void openListed(item.workspaceId, item.value.id)}
                        >
                          <strong>{item.value.title || 'Untitled'}</strong>
                          <span>{formatWhen(item.value.updatedAt)}</span>
                          <p>{item.value.body.slice(0, 80) || 'Empty note'}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              />
            ) : null}
          </section>

          <section className="notes-panel notes-editor-panel">
            {activeNote ? (
              <>
                <div className="notes-editor-toolbar">
                  <label className="field field-grow">
                    Title
                    <input
                      type="text"
                      value={activeNote.title}
                      onChange={(e) => updateActive({ title: e.target.value })}
                    />
                  </label>
                  <button type="button" className="btn-danger btn-sm" onClick={deleteActive}>
                    <TranslatedText message="delete" />
                  </button>
                </div>

                <label className="field">
                  Body
                  <textarea
                    value={activeNote.body}
                    onChange={(e) => updateActive({ body: e.target.value })}
                    placeholder="Write your note..."
                    rows={14}
                  />
                </label>

                <p className="notes-meta">
                  Last updated {formatWhen(activeNote.updatedAt)}
                </p>
              </>
            ) : (
              <div className="notes-empty">
                <p>No notes yet.</p>
                <button type="button" className="btn-primary" onClick={createNote}>
                  Create your first note
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
