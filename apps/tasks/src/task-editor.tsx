import { useEffect, useId, useRef, useState } from 'react';
import type { TaskItem } from '@sorye/types';
import type { TaskPatch } from './status-handler';
import { deleteTaskPhoto, taskPhotoRejection, taskPhotoUrl, uploadTaskPhoto } from './task-photo';

interface TaskEditorProps {
  task: TaskItem;
  onPersist: (taskId: string, patch: TaskPatch) => Promise<void>;
  onClose: () => void;
}

interface Draft {
  title: string;
  body: string;
  pendingFile: File | null;
  cleared: boolean;
}

function outsideDialog(event: PointerEvent, dialog: HTMLDialogElement) {
  const rect = dialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}

export function TaskEditor({ task, onPersist, onClose }: TaskEditorProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const persistRef = useRef<(draft: Draft) => Promise<boolean>>(async () => false);
  const draftRef = useRef<Draft>({ title: task.title, body: task.body, pendingFile: null, cleared: false });
  const savedRef = useRef(false);
  const busyRef = useRef(false);
  const originalRef = useRef({ title: task.title, body: task.body, driveFileId: task.driveFileId });
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [cleared, setCleared] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft = { title, body, pendingFile, cleared };
  draftRef.current = draft;
  onCloseRef.current = onClose;

  const storedPhoto = !cleared && !pendingFile ? taskPhotoUrl(task.driveFileId) : null;
  const shownPhoto = previewUrl ?? storedPhoto;

  function isDirty(value: Draft) {
    const original = originalRef.current;
    return value.title.trim() !== original.title || value.body !== original.body || value.pendingFile !== null || value.cleared;
  }

  async function persist(value: Draft): Promise<boolean> {
    const label = value.title.trim();
    if (!label) {
      setError('Add a label before saving.');
      return false;
    }
    if (label.length > 200) {
      setError('The label is too long.');
      return false;
    }
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let uploaded: string | undefined;
    try {
      uploaded = value.pendingFile ? await uploadTaskPhoto(value.pendingFile) : undefined;
      const driveFileId = value.pendingFile ? uploaded : value.cleared ? undefined : originalRef.current.driveFileId;
      const patch: TaskPatch = { title: label, body: value.body, driveFileId };
      await onPersist(task.id, patch);
      const previous = originalRef.current.driveFileId;
      if (previous && previous !== driveFileId) void deleteTaskPhoto(previous);
      originalRef.current = { title: label, body: value.body, driveFileId };
      return true;
    } catch (err) {
      if (uploaded) void deleteTaskPhoto(uploaded);
      setError(err instanceof Error ? err.message : 'Could not save this task.');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  persistRef.current = persist;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.setAttribute('closedby', 'any');
    if (!dialog.open) dialog.showModal();
    const onDialogClose = () => {
      void (async () => {
        if (savedRef.current || busyRef.current) {
          if (savedRef.current) onCloseRef.current();
          return;
        }
        const current = draftRef.current;
        if (!isDirty(current)) {
          onCloseRef.current();
          return;
        }
        const ok = await persistRef.current(current);
        if (ok) onCloseRef.current();
        else if (!dialog.open) dialog.showModal();
      })();
    };
    dialog.addEventListener('close', onDialogClose);
    let removeLightDismiss = () => {};
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const onPointerDown = (event: PointerEvent) => {
        pressedOutside = outsideDialog(event, dialog);
      };
      const onPointerUp = (event: PointerEvent) => {
        if (pressedOutside && outsideDialog(event, dialog) && !busyRef.current) dialog.close();
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', onPointerDown);
      dialog.addEventListener('pointerup', onPointerUp);
      removeLightDismiss = () => {
        dialog.removeEventListener('pointerdown', onPointerDown);
        dialog.removeEventListener('pointerup', onPointerUp);
      };
    }
    return () => {
      dialog.removeEventListener('close', onDialogClose);
      removeLightDismiss();
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (!pendingFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  function takePhoto(file: File | undefined) {
    if (!file) return;
    const rejection = taskPhotoRejection(file);
    if (rejection) {
      setError(rejection);
      return;
    }
    setError(null);
    setCleared(false);
    setPendingFile(file);
  }

  return (
    <dialog
      ref={dialogRef}
      className="task-editor"
      aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined}
      aria-busy={busy ? 'true' : 'false'}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            const ok = await persist(draftRef.current);
            if (!ok) return;
            savedRef.current = true;
            dialogRef.current?.close();
          })();
        }}
      >
        <header className="task-editor-header">
          <h2 id={titleId}>Edit task</h2>
          <button type="button" className="btn-icon" aria-label="Close" onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        <label className="field">
          Label
          <input
            autoFocus
            value={title}
            maxLength={200}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field" htmlFor={descriptionId}>
          Description
        </label>
        <textarea
          id={descriptionId}
          value={body}
          rows={4}
          maxLength={8000}
          placeholder="Add details..."
          onChange={(event) => setBody(event.target.value)}
        />
        <label
          className={dragOver ? 'task-photo-drop drag-over' : 'task-photo-drop'}
          aria-label="Task photo. Drag a photo here or choose a file."
          onDragEnter={(event) => {
            if (![...event.dataTransfer.types].includes('Files')) return;
            event.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(event) => {
            if (![...event.dataTransfer.types].includes('Files')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            if (![...event.dataTransfer.types].includes('Files')) return;
            event.preventDefault();
            event.stopPropagation();
            setDragOver(false);
            takePhoto(event.dataTransfer.files[0]);
          }}
        >
          <input
            className="task-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => {
              takePhoto(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {shownPhoto ? (
            <img src={shownPhoto} alt="Task photo" width={480} height={270} decoding="async" />
          ) : (
            <span>Drag a photo here, or choose a file.</span>
          )}
        </label>
        {shownPhoto ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setPendingFile(null);
              setCleared(true);
            }}
          >
            Remove photo
          </button>
        ) : null}
        {error ? (
          <p id={errorId} className="task-editor-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="task-editor-actions">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
