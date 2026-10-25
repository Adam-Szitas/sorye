'use client';

import {
  FILE_DISPLAY_NAME_MAX,
  FILE_MAX_BYTES,
  type FileListResponse,
  type WorkspaceFile,
} from '@sorye/types';
import { isInlinePreviewMime } from '@/lib/file-preview';
import { filterWorkspaceFiles } from '@/lib/file-search';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]/50';

const ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv,text/markdown,application/json,.jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.csv,.md,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

const TEXT_PREVIEW_MAX = 256 * 1024;

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type DriveAction = 'open' | 'download' | 'rename' | 'delete';

const DRIVE_ACTION_CLASS: Record<DriveAction, string> = {
  open: 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25',
  download: 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25',
  rename: 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25',
  delete: 'bg-red-500/15 text-red-300 hover:bg-red-500/25',
};

const DRIVE_ICON_BUTTON =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';

function DriveActionIcon({ action }: { action: DriveAction }) {
  const props = {
    viewBox: '0 0 24 24',
    className: 'size-4',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };

  if (action === 'open') {
    return (
      <svg {...props}>
        <path d="M14 5h5v5" />
        <path d="M19 5 10 14" />
        <path d="M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5" />
      </svg>
    );
  }

  if (action === 'download') {
    return (
      <svg {...props}>
        <path d="M12 4v11" />
        <path d="M7.5 11.5 12 16l4.5-4.5" />
        <path d="M5 19h14" />
      </svg>
    );
  }

  if (action === 'rename') {
    return (
      <svg {...props}>
        <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
        <path d="M13.5 6.5l3 3" />
      </svg>
    );
  }

  return (
    <svg {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M7 7l1 13h8l1-13" />
    </svg>
  );
}

function kindLabel(mime: string): string {
  if (mime.startsWith('image/')) return 'Image';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('word')) return 'Word';
  if (mime.includes('excel') || mime.includes('spreadsheet')) return 'Spreadsheet';
  if (mime.includes('powerpoint') || mime.includes('presentation')) {
    return 'Slides';
  }
  if (mime.startsWith('text/') || mime === 'application/json') return 'Text';
  return mime;
}

function previewKind(mime: string): 'image' | 'pdf' | 'text' | null {
  if (!isInlinePreviewMime(mime)) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'text';
}

function inlineUrl(id: string): string {
  return `/api/files/${id}?inline=1`;
}

function supportsClosedBy(): boolean {
  return (
    typeof HTMLDialogElement !== 'undefined' &&
    'closedBy' in HTMLDialogElement.prototype
  );
}

function DriveModal({
  labelledBy,
  onClose,
  wide,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !mounted) return;
    if (!supportsClosedBy()) return;
    dialog.setAttribute('closedby', 'any');
  }, [mounted]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !mounted) return;
    if (!dialog.open) dialog.showModal();
  }, [mounted]);

  function onBackdropClick(event: SyntheticEvent<HTMLDialogElement>) {
    if (supportsClosedBy()) return;
    const dialog = event.currentTarget;
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const native = event.nativeEvent as MouseEvent;
    const inside =
      rect.top <= native.clientY &&
      native.clientY <= rect.top + rect.height &&
      rect.left <= native.clientX &&
      native.clientX <= rect.left + rect.width;
    if (!inside) dialog.close();
  }

  if (!mounted) return null;

  return createPortal(
    <>
      <style>{`
        .hub-modal {
          position: fixed;
          inset: 0;
          margin: auto;
          height: fit-content;
          max-height: min(90dvh, 52rem);
          overscroll-behavior: contain;
        }
        .hub-modal::backdrop {
          background: rgba(0, 0, 0, 0.6);
          overflow: hidden;
          overscroll-behavior: contain;
        }
      `}</style>
      <dialog
        ref={dialogRef}
        className={`hub-modal overflow-hidden rounded-2xl border border-white/10 bg-[var(--color-surface-raised)] p-0 text-[var(--color-text)] shadow-2xl ${
          wide ? 'w-[min(56rem,calc(100%-2rem))]' : 'w-[min(28rem,calc(100%-2rem))]'
        }`}
        aria-labelledby={labelledBy}
        onClick={onBackdropClick}
        onClose={onClose}
      >
        {children}
      </dialog>
    </>,
    document.body,
  );
}

function FilePreviewDialog({
  file,
  onClose,
  onDownload,
}: {
  file: WorkspaceFile;
  onClose: () => void;
  onDownload: (file: WorkspaceFile) => void;
}) {
  const uid = useId();
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const kind = previewKind(file.mime);
  const src = inlineUrl(file.id);

  useEffect(() => {
    if (kind !== 'text') return;
    let cancelled = false;
    setText(null);
    setLoadError(null);
    setTruncated(false);
    void (async () => {
      try {
        const res = await fetch(src, { credentials: 'include' });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? 'Could not open file');
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        const slice =
          bytes.byteLength > TEXT_PREVIEW_MAX
            ? bytes.subarray(0, TEXT_PREVIEW_MAX)
            : bytes;
        const decoded = new TextDecoder().decode(slice);
        if (!cancelled) {
          setText(decoded);
          setTruncated(bytes.byteLength > TEXT_PREVIEW_MAX);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not open file');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, src]);

  return (
    <DriveModal labelledBy={`${uid}-preview-title`} onClose={onClose} wide>
      <div className="flex max-h-[min(90dvh,52rem)] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/8 px-5 py-4">
          <div className="min-w-0">
            <h2
              id={`${uid}-preview-title`}
              className="truncate text-base font-semibold"
            >
              {file.displayName}
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {kindLabel(file.mime)} · {formatSize(file.size)}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className={`${DRIVE_ICON_BUTTON} ${DRIVE_ACTION_CLASS.open}`}
              aria-label={`New tab ${file.displayName}`}
            >
              <DriveActionIcon action="open" />
            </a>
            <button
              type="button"
              className={`${DRIVE_ICON_BUTTON} ${DRIVE_ACTION_CLASS.download}`}
              aria-label={`Download ${file.displayName}`}
              onClick={() => onDownload(file)}
            >
              <DriveActionIcon action="download" />
            </button>
            <form method="dialog">
              <button
                type="submit"
                className={`${DRIVE_ICON_BUTTON} text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-text)]`}
                aria-label="Close"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </form>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {kind === 'image' ? (
            <img
              src={src}
              alt={file.displayName}
              className="mx-auto max-h-[min(70dvh,40rem)] max-w-full object-contain"
              decoding="async"
            />
          ) : null}
          {kind === 'pdf' ? (
            <iframe
              src={src}
              title={file.displayName}
              className="h-[min(70dvh,40rem)] w-full rounded-lg border border-white/8 bg-black/30"
            />
          ) : null}
          {kind === 'text' ? (
            loadError ? (
              <p className="text-sm text-red-300" role="alert">
                {loadError}
              </p>
            ) : text === null ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Loading preview…
              </p>
            ) : (
              <>
                {truncated ? (
                  <p className="mb-2 text-xs text-[var(--color-text-muted)]">
                    Showing the first {formatSize(TEXT_PREVIEW_MAX)}. Download
                    for the full file.
                  </p>
                ) : null}
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-white/8 bg-black/30 p-3 font-mono text-xs leading-relaxed">
                  {text}
                </pre>
              </>
            )
          ) : null}
          {kind === null ? (
            <p className="py-6 text-sm text-[var(--color-text-muted)]">
              This file does not have an inline preview. Download it to open
              it in another app.
            </p>
          ) : null}
        </div>
      </div>
    </DriveModal>
  );
}

export function AppFiles() {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<WorkspaceFile[] | null>(null);
  const [maxBytes, setMaxBytes] = useState(FILE_MAX_BYTES);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WorkspaceFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceFile | null>(null);
  const [previewTarget, setPreviewTarget] = useState<WorkspaceFile | null>(null);
  const [query, setQuery] = useState('');
  const [regexMode, setRegexMode] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/files', { credentials: 'include' });
    const data = (await res.json().catch(() => ({}))) as FileListResponse & {
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error ?? 'Could not load Drive');
    }
    setFiles(data.files);
    setMaxBytes(data.maxBytes ?? FILE_MAX_BYTES);
    return data.files;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load Drive');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const filtered = useMemo(
    () => filterWorkspaceFiles(files ?? [], query, regexMode),
    [files, query, regexMode],
  );

  async function uploadList(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (incoming.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      for (const item of incoming) {
        const body = new FormData();
        body.append('file', item);
        const res = await fetch('/api/files', {
          method: 'POST',
          credentials: 'include',
          body,
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          file?: WorkspaceFile;
        };
        if (!res.ok) {
          throw new Error(data.error ?? `Could not upload ${item.name}`);
        }
      }
      await load();
      setNotice(
        incoming.length === 1
          ? `Uploaded ${incoming[0]?.name ?? 'file'}`
          : `Uploaded ${incoming.length} files`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function downloadFile(file: WorkspaceFile) {
    setError(null);
    try {
      const res = await fetch(`/api/files/${file.id}`, { credentials: 'include' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Could not download');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.displayName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download');
    }
  }

  async function saveRename() {
    if (!renameTarget) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${renameTarget.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: renameValue }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        file?: WorkspaceFile;
      };
      if (!res.ok) {
        throw new Error(data.error ?? 'Could not rename');
      }
      await load();
      setNotice(`Renamed to ${data.file?.displayName ?? renameValue}`);
      setRenameTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/files/${deleteTarget.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? 'Could not delete');
      }
      await load();
      setNotice(`Deleted ${deleteTarget.displayName}`);
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    } finally {
      setBusy(false);
    }
  }

  if (!files) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-text-muted)]">
        {error ?? 'Loading Drive…'}
      </div>
    );
  }

  const maxMb = Math.floor(maxBytes / (1024 * 1024));
  const renameId = `${uid}-rename`;
  const dropId = `${uid}-drop`;
  const searchId = `${uid}-search`;
  const regexId = `${uid}-regex`;
  const searching = query.trim().length > 0;
  const visible = filtered.files;

  return (
    <div className="@container relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Drive</h1>
          <p className="text-xs text-[var(--color-text-muted)]">
            {searching
              ? `${visible.length} of ${files.length} file${files.length === 1 ? '' : 's'}`
              : `${files.length} file${files.length === 1 ? '' : 's'}`}
            {' · '}
            up to {maxMb} MB each
          </p>
        </div>
        <label className="rounded-lg bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-surface)] transition hover:brightness-110">
          {busy ? 'Working…' : 'Upload'}
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept={ACCEPT}
            multiple
            disabled={busy}
            onChange={(event) => {
              if (event.target.files) void uploadList(event.target.files);
            }}
          />
        </label>
      </header>

      {error ? (
        <p className="shrink-0 px-4 pt-3 text-xs text-red-300 sm:px-5" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="shrink-0 px-4 pt-3 text-xs text-[var(--color-accent)] sm:px-5"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <div
        id={dropId}
        className={`mx-4 mt-3 shrink-0 rounded-xl border border-dashed px-4 py-6 text-center text-sm transition sm:mx-5 ${
          dragOver
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-text)]'
            : 'border-white/12 text-[var(--color-text-muted)]'
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void uploadList(event.dataTransfer.files);
        }}
      >
        Drop files here, or use Upload. Images, PDF, text, and Office — no
        executables.
      </div>

      <div className="mx-4 mt-3 shrink-0 sm:mx-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={searchId}>
              Search
            </label>
            <input
              id={searchId}
              className={FIELD_CLASS}
              type="search"
              value={query}
              placeholder="Name, type:pdf, or /regex/"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <label
            className="flex items-center gap-2 pb-2 text-xs text-[var(--color-text-muted)]"
            htmlFor={regexId}
          >
            <input
              id={regexId}
              type="checkbox"
              checked={regexMode}
              onChange={(event) => setRegexMode(event.target.checked)}
            />
            Regex
          </label>
        </div>
        {filtered.error ? (
          <p className="mt-1 text-xs text-red-300" role="alert">
            {filtered.error}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-5">
        {files.length === 0 ? (
          <p className="py-8 text-sm text-[var(--color-text-muted)]">
            No files in this workspace yet.
          </p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-sm text-[var(--color-text-muted)]">
            No files match this search.
          </p>
        ) : (
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <caption className="sr-only">Workspace files</caption>
            <thead>
              <tr className="border-b border-white/8 text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Size</th>
                <th className="py-2 pr-3 font-medium">Updated</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((file) => {
                return (
                  <tr key={file.id} className="border-b border-white/6">
                    <td className="max-w-[16rem] py-3 pr-3">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium text-[var(--color-accent)] hover:underline"
                        onClick={() => setPreviewTarget(file)}
                      >
                        {file.displayName}
                      </button>
                      <div className="truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                        {file.relativePath}
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-[var(--color-text-muted)]">
                      {kindLabel(file.mime)}
                    </td>
                    <td className="py-3 pr-3 text-[var(--color-text-muted)]">
                      {formatSize(file.size)}
                    </td>
                    <td className="py-3 pr-3 text-[var(--color-text-muted)]">
                      <time dateTime={file.updatedAt}>{formatWhen(file.updatedAt)}</time>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-wrap justify-end gap-1">
                        {(
                          [
                            ['open', 'Open', () => setPreviewTarget(file)],
                            ['download', 'Download', () => void downloadFile(file)],
                            ['rename', 'Rename', () => {
                              setRenameTarget(file);
                              setRenameValue(file.displayName);
                            }],
                            ['delete', 'Delete', () => setDeleteTarget(file)],
                          ] as const
                        ).map(([action, label, onClick]) => (
                          <button
                            key={action}
                            type="button"
                            className={`${DRIVE_ICON_BUTTON} ${DRIVE_ACTION_CLASS[action]}`}
                            aria-label={`${label} ${file.displayName}`}
                            onClick={onClick}
                          >
                            <DriveActionIcon action={action} />
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {previewTarget ? (
        <FilePreviewDialog
          file={previewTarget}
          onClose={() => setPreviewTarget(null)}
          onDownload={(item) => void downloadFile(item)}
        />
      ) : null}

      {renameTarget ? (
        <DriveModal labelledBy={`${uid}-rename-title`} onClose={() => setRenameTarget(null)}>
          <form
            className="p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void saveRename();
            }}
          >
            <h2 id={`${uid}-rename-title`} className="text-base font-semibold">
              Rename file
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Changes the display name only. Storage id stays {renameTarget.id}.
            </p>
            <label className="mt-4 block text-sm font-medium" htmlFor={renameId}>
              Display name
            </label>
            <input
              id={renameId}
              className={FIELD_CLASS}
              value={renameValue}
              maxLength={FILE_DISPLAY_NAME_MAX}
              autoFocus
              onChange={(event) => setRenameValue(event.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-white/10"
                onClick={() => setRenameTarget(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-surface)] disabled:opacity-50"
                disabled={busy || !renameValue.trim()}
              >
                Save
              </button>
            </div>
          </form>
        </DriveModal>
      ) : null}

      {deleteTarget ? (
        <DriveModal labelledBy={`${uid}-delete-title`} onClose={() => setDeleteTarget(null)}>
          <div className="p-5">
            <h2 id={`${uid}-delete-title`} className="text-base font-semibold">
              Delete file
            </h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Remove {deleteTarget.displayName} from this workspace? The file is
              deleted from disk.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-white/10"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-500/90 px-3.5 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                Delete
              </button>
            </div>
          </div>
        </DriveModal>
      ) : null}
    </div>
  );
}
