import { useCallback, useMemo, useRef, useState } from 'react';
import { loadNotes, saveNotes, type Note } from './notes-storage';
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
  const [notes, setNotes] = useState<Note[]>(() => loadNotes());
  const [activeId, setActiveId] = useState<string | null>(
    () => loadNotes()[0]?.id ?? null,
  );
  const emitTimer = useRef<number | null>(null);

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeId) ?? null,
    [notes, activeId],
  );

  const persist = useCallback((next: Note[]) => {
    setNotes(next);
    saveNotes(next);
  }, []);

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
    persist(next);
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
    persist(next);
    setActiveId(next[0]?.id ?? null);
  };

  return (
    <div className="notes-app">
      <header className="notes-header">
        <div>
          <h1>Notes</h1>
          <p>Quick capture for ideas, docs, and meeting notes</p>
        </div>
        <span className="notes-badge">Productivity</span>
      </header>

      <div className="notes-layout">
        <section className="notes-panel notes-list-panel">
          <div className="notes-list-toolbar">
            <h2>All notes</h2>
            <button type="button" className="btn-primary btn-sm" onClick={createNote}>
              New
            </button>
          </div>

          <ul className="notes-list">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className={note.id === activeId ? 'active' : undefined}
                  onClick={() => setActiveId(note.id)}
                >
                  <strong>{note.title || 'Untitled'}</strong>
                  <span>{formatWhen(note.updatedAt)}</span>
                  <p>{note.body.slice(0, 80) || 'Empty note'}</p>
                </button>
              </li>
            ))}
          </ul>
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
                  Delete
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
    </div>
  );
}
