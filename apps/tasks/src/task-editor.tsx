import { useEffect, useId, useRef, useState } from 'react';
import { Select } from '@sorye/sdk/react';
import { taskImageIds, type TaskItem, type TaskStatus } from '@sorye/types';
import type { TaskPatch } from './status-handler';
import {
  deleteTaskPhoto,
  imageFilesFromTransfer,
  takeTaskImages,
  taskPhotoUrl,
  uploadTaskPhoto,
} from './task-photo';

interface TaskEditorProps {
  task: TaskItem;
  statuses: TaskStatus[];
  onPersist: (taskId: string, patch: TaskPatch) => Promise<void>;
  onClose: () => void;
}

interface PendingImage {
  key: string;
  file: File;
  url: string;
}

interface Draft {
  title: string;
  body: string;
  statusId: string;
  keptIds: string[];
  pending: PendingImage[];
}

interface Original {
  title: string;
  body: string;
  statusId: string;
  ids: string[];
}

function outsideDialog(event: PointerEvent, dialog: HTMLDialogElement) {
  const rect = dialog.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function TaskEditor({ task, statuses, onPersist, onClose }: TaskEditorProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const persistRef = useRef<(draft: Draft) => Promise<boolean>>(async () => false);
  const initialIds = taskImageIds(task);
  const draftRef = useRef<Draft>({
    title: task.title,
    body: task.body,
    statusId: task.statusId,
    keptIds: initialIds,
    pending: [],
  });
  const savedRef = useRef(false);
  const busyRef = useRef(false);
  const originalRef = useRef<Original>({
    title: task.title,
    body: task.body,
    statusId: task.statusId,
    ids: initialIds,
  });
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body);
  const [statusId, setStatusId] = useState(task.statusId);
  const [keptIds, setKeptIds] = useState<string[]>(initialIds);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const draft = { title, body, statusId, keptIds, pending };
  draftRef.current = draft;
  onCloseRef.current = onClose;
  const sharePath = `${window.location.pathname}?ticket=${encodeURIComponent(task.id)}`;

  function isDirty(value: Draft) {
    const original = originalRef.current;
    return value.title.trim() !== original.title
      || value.body !== original.body
      || value.statusId !== original.statusId
      || value.pending.length > 0
      || !sameIds(value.keptIds, original.ids);
  }

  function addFiles(files: File[]) {
    const decision = takeTaskImages(draftRef.current.keptIds.length + draftRef.current.pending.length, files);
    if (decision.error) {
      setError(decision.error);
      return;
    }
    if (decision.accepted.length === 0) return;
    setError(null);
    setPending((current) => {
      const seen = new Set(current.map((image) => `${image.file.name}:${image.file.size}:${image.file.lastModified}`));
      const fresh = decision.accepted.filter((file) => {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return [
        ...current,
        ...fresh.map((file) => ({
          key: crypto.randomUUID(),
          file,
          url: URL.createObjectURL(file),
        })),
      ];
    });
  }

  function onPaste(event: React.ClipboardEvent) {
    const { images, rejected } = imageFilesFromTransfer(event.clipboardData);
    if (rejected && images.length === 0) {
      event.preventDefault();
      setError('Only JPEG, PNG, WebP, or GIF images can be added.');
      return;
    }
    if (images.length === 0) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text.trim()) event.preventDefault();
    addFiles(images);
  }

  async function persist(value: Draft): Promise<boolean> {
    const label = value.title.trim();
    if (!label) {
      setError('Add a summary before saving.');
      return false;
    }
    if (label.length > 200) {
      setError('The summary is too long.');
      return false;
    }
    const room = takeTaskImages(value.keptIds.length, value.pending.map((image) => image.file));
    if (room.error) {
      setError(room.error);
      return false;
    }
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const uploaded: string[] = [];
    try {
      for (const image of value.pending) uploaded.push(await uploadTaskPhoto(image.file));
      const attachmentIds = [...new Set([...value.keptIds, ...uploaded])];
      const patch: TaskPatch = {
        title: label,
        body: value.body,
        statusId: value.statusId,
        attachmentIds,
      };
      await onPersist(task.id, patch);
      const removed = originalRef.current.ids.filter((id) => !attachmentIds.includes(id));
      for (const id of removed) void deleteTaskPhoto(id);
      originalRef.current = { title: label, body: value.body, statusId: value.statusId, ids: attachmentIds };
      return true;
    } catch (err) {
      for (const id of uploaded) void deleteTaskPhoto(id);
      setError(err instanceof Error ? err.message : 'Could not save this ticket.');
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
    const onCancel = (event: Event) => {
      if (busyRef.current) event.preventDefault();
    };
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
    dialog.addEventListener('cancel', onCancel);
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
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onDialogClose);
      removeLightDismiss();
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => () => {
    for (const image of draftRef.current.pending) URL.revokeObjectURL(image.url);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyId() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(task.id);
      setCopied(true);
      setError(null);
    } catch {
      idRef.current?.focus();
      idRef.current?.select();
      setCopied(false);
      setError('Clipboard is unavailable. The ticket id is selected so you can copy it.');
    }
  }

  function removeKept(id: string) {
    setKeptIds((current) => current.filter((item) => item !== id));
  }

  function removePending(key: string) {
    setPending((current) => {
      const image = current.find((item) => item.key === key);
      if (image) URL.revokeObjectURL(image.url);
      return current.filter((item) => item.key !== key);
    });
  }

  const shown = [
    ...keptIds.map((id, index) => ({ key: id, src: taskPhotoUrl(id), index })),
    ...pending.map((image, index) => ({ key: image.key, src: image.url, index: keptIds.length + index })),
  ];

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
        onPaste={onPaste}
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
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragOver(false);
        }}
        onDrop={(event) => {
          if (![...event.dataTransfer.types].includes('Files')) return;
          event.preventDefault();
          event.stopPropagation();
          setDragOver(false);
          const { images, rejected } = imageFilesFromTransfer(event.dataTransfer);
          if (rejected && images.length === 0) {
            setError('Only JPEG, PNG, WebP, or GIF images can be added.');
            return;
          }
          addFiles(images);
        }}
      >
        <header className="task-editor-header">
          <h2 id={titleId} className="task-ticket-heading">
            <span className="task-ticket-kicker">Ticket</span>
            <input
              ref={idRef}
              className="task-ticket-id"
              readOnly
              value={task.id}
              size={Math.min(Math.max(task.id.length, 8), 48)}
              aria-label="Ticket id"
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="btn-ghost" onClick={() => void copyId()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </h2>
          <button type="button" className="btn-icon" aria-label="Close" onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        <p className="task-ticket-share" role="status">
          {copied ? 'Copied the ticket id. ' : ''}
          A coworker with Tasks access in this workspace opens <span className="task-ticket-path">{sharePath}</span>
        </p>
        <label className="field">
          Summary
          <input
            autoFocus
            value={title}
            maxLength={200}
            required
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <Select
          label="Status"
          value={statusId}
          options={statuses.map((status) => ({ value: status.id, label: status.name }))}
          onSoryeChange={(event) => {
            const next = event.detail.value;
            if (next && statuses.some((status) => status.id === next)) setStatusId(next);
          }}
        />
        <label className="field" htmlFor={descriptionId}>
          Description
        </label>
        <textarea
          id={descriptionId}
          className={dragOver ? 'drag-over' : undefined}
          value={body}
          rows={6}
          maxLength={8000}
          placeholder="Paste notes or images"
          onChange={(event) => setBody(event.target.value)}
        />
        {shown.length > 0 ? (
          <ul className="task-attachment-list">
            {shown.map((image) => (
              <li key={image.key}>
                {image.src ? (
                  <img src={image.src} alt={`Attached image ${image.index + 1}`} width={320} height={180} decoding="async" />
                ) : null}
                <button type="button" className="btn-ghost" onClick={() => {
                  if (keptIds.includes(image.key)) removeKept(image.key);
                  else removePending(image.key);
                }}>
                  Remove image {image.index + 1}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <label className={dragOver ? 'task-photo-drop drag-over' : 'task-photo-drop'}>
          <input
            className="task-photo-input"
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => {
              addFiles([...(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          <span>Paste, drop, or choose images. JPEG, PNG, WebP, or GIF, up to 5 MB each, 8 per ticket.</span>
        </label>
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
