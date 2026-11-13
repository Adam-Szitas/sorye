'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  cancelUpload,
  clearFinishedUploads,
  dismissUpload,
  getServerUploadSnapshot,
  getUploadSnapshot,
  retryUpload,
  subscribeUploads,
  type UploadItem,
  type UploadSnapshot,
  type UploadTotals,
} from '@/lib/upload-queue';

export function useUploads(): UploadSnapshot {
  return useSyncExternalStore(subscribeUploads, getUploadSnapshot, getServerUploadSnapshot);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function percent(loaded: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
}

function statusText(item: UploadItem): string {
  switch (item.status) {
    case 'queued': return 'Waiting';
    case 'hashing': return 'Computing checksum…';
    case 'uploading': return `Uploading ${percent(item.loaded, item.size)}%`;
    // Sent from the browser's view; the server may still be reading (throttle) and verifying.
    case 'processing': return item.checksummed ? 'Server receiving and verifying…' : 'Server receiving…';
    case 'done': return item.checksummed ? 'Uploaded · checksum verified' : 'Uploaded';
    case 'canceled': return 'Canceled';
    case 'corrupted': return 'Damaged in transfer — upload this file again';
    default: return item.error ?? 'Failed';
  }
}

const BAR_TONE: Record<UploadItem['status'], string> = {
  queued: 'bg-white/20',
  hashing: 'bg-[var(--color-accent)]/60',
  uploading: 'bg-[var(--color-accent)]',
  processing: 'bg-[var(--color-accent)]',
  done: 'bg-emerald-400',
  canceled: 'bg-white/20',
  failed: 'bg-red-400',
  corrupted: 'bg-amber-400',
};

function Bar({ value, tone, label }: { value: number; tone: string; label: string }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <div className={`h-full rounded-full transition-[width] duration-200 ${tone}`} style={{ width: `${value}%` }} />
    </div>
  );
}

export function BatchProgress({ totals }: { totals: UploadTotals }) {
  const value = percent(totals.loadedBytes, totals.bytes);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">
          {totals.active > 0 ? `Uploading ${totals.done} of ${totals.total}` : `${totals.done} of ${totals.total} uploaded`}
          {totals.failed > 0 ? <span className="text-red-300"> · {totals.failed} need attention</span> : null}
        </span>
        <span className="tabular-nums text-[var(--color-text-muted)]">
          {formatSize(totals.loadedBytes)} / {formatSize(totals.bytes)} · {value}%
        </span>
      </div>
      <Bar value={value} tone={totals.failed > 0 && totals.active === 0 ? 'bg-amber-400' : 'bg-[var(--color-accent)]'} label="All uploads" />
    </div>
  );
}

export function UploadProgressList({ items, compact = false }: { items: UploadItem[]; compact?: boolean }) {
  if (items.length === 0) return null;
  const ordered = [...items].reverse();
  return (
    <ul className={`space-y-2 ${compact ? 'max-h-72 overflow-y-auto pr-1' : ''}`} aria-label="Uploads">
      {ordered.map((item) => {
        const finished = item.status === 'done' || item.status === 'canceled' || item.status === 'failed' || item.status === 'corrupted';
        const problem = item.status === 'failed' || item.status === 'corrupted';
        const value = item.status === 'done' ? 100 : percent(item.loaded, item.size);
        return (
          <li key={item.id} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium" title={item.name}>{item.name}</p>
                <p
                  className={`text-[11px] ${item.status === 'corrupted' ? 'text-amber-300' : problem ? 'text-red-300' : 'text-[var(--color-text-muted)]'}`}
                  role={problem ? 'alert' : undefined}
                >
                  {formatSize(item.size)} · {problem && item.status === 'failed' ? item.error : statusText(item)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {problem && item.canRetry ? (
                  <button
                    type="button"
                    className="rounded-md bg-[var(--color-accent)]/15 px-2 py-1 text-[11px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25"
                    onClick={() => retryUpload(item.id)}
                    aria-label={`Upload ${item.name} again`}
                  >
                    Retry
                  </button>
                ) : null}
                {!finished ? (
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:bg-white/10"
                    onClick={() => cancelUpload(item.id)}
                    aria-label={`Cancel ${item.name}`}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rounded-md px-1.5 py-1 text-[11px] text-[var(--color-text-muted)] hover:bg-white/10"
                    onClick={() => dismissUpload(item.id)}
                    aria-label={`Remove ${item.name} from the list`}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
            {!compact || !finished ? (
              <div className="mt-1.5">
                <Bar value={value} tone={BAR_TONE[item.status]} label={`${item.name} progress`} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Compact upload status in the Hub top bar; visible in every app while uploads exist. */
export function TopBarUploadIndicator({ onOpenDrive }: { onOpenDrive: () => void }) {
  const { items, totals } = useUploads();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (totals.total === 0) return null;
  const value = percent(totals.loadedBytes, totals.bytes);
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const tone = totals.failed > 0 ? 'text-amber-300' : totals.active > 0 ? 'text-[var(--color-accent)]' : 'text-emerald-300';
  const label = totals.active > 0
    ? `Uploads: ${totals.done} of ${totals.total} done, ${value}%`
    : totals.failed > 0 ? `Uploads: ${totals.failed} need attention` : `Uploads: ${totals.done} done`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition hover:bg-white/10 ${tone}`}
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90" aria-hidden>
          <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
          <circle
            cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)}
            className="transition-[stroke-dashoffset] duration-200"
          />
        </svg>
        <span className="tabular-nums" aria-hidden>
          {totals.active > 0 ? `${value}%` : totals.failed > 0 ? `${totals.failed}!` : '✓'}
        </span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Uploads"
          className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[var(--color-surface-raised)] p-3 text-[var(--color-text)] shadow-2xl"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Drive uploads</h2>
            <div className="flex gap-1">
              <button type="button" className="rounded-md px-2 py-1 text-[11px] text-[var(--color-accent)] hover:bg-white/10" onClick={() => { setOpen(false); onOpenDrive(); }}>
                Open Drive
              </button>
              {totals.active < totals.total ? (
                <button type="button" className="rounded-md px-2 py-1 text-[11px] text-[var(--color-text-muted)] hover:bg-white/10" onClick={clearFinishedUploads}>
                  Clear finished
                </button>
              ) : null}
            </div>
          </div>
          <div className="mb-3"><BatchProgress totals={totals} /></div>
          <UploadProgressList items={items} compact />
          <p className="mt-2 text-[10px] text-[var(--color-text-muted)]">Uploads continue while you use other apps. Closing or reloading this tab stops them.</p>
        </div>
      ) : null}
    </div>
  );
}
