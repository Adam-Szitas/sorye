'use client';

import {
  MAIL_BODY_MAX,
  MAIL_SUBJECT_MAX,
  type MailComposeDetail,
  type MailMember,
} from '@sorye/types';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  compressImageFile,
  imageFileFromClipboardItem,
} from '@/components/compress-image';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]/50';

export interface MailComposeDialogProps {
  open: boolean;
  members: MailMember[];
  currentUserId: string;
  initial?: MailComposeDetail | null;
  onClose: () => void;
  onSent?: () => void;
}

function supportsClosedBy(): boolean {
  return (
    typeof HTMLDialogElement !== 'undefined' &&
    'closedBy' in HTMLDialogElement.prototype
  );
}

export function MailComposeDialog({
  open,
  members,
  currentUserId,
  initial,
  onClose,
  onSent,
}: MailComposeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const [mounted, setMounted] = useState(false);
  const [toUserId, setToUserId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const recipients = members;
  const defaultTo =
    recipients.find((member) => member.userId !== currentUserId)?.userId ??
    recipients[0]?.userId ??
    '';

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
    if (open) {
      setToUserId((current) => current || defaultTo);
      setSubject(initial?.subject ?? '');
      setBody(initial?.body ?? '');
      setImageDataUrl(initial?.imageDataUrl);
      setError(null);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, mounted, initial, defaultTo]);

  async function attachFile(file: File | null) {
    if (!file) return;
    setAttaching(true);
    setError(null);
    try {
      const compressed = await compressImageFile(file);
      setImageDataUrl(compressed.dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach image');
    } finally {
      setAttaching(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith('image/')) continue;
      event.preventDefault();
      void imageFileFromClipboardItem(item).then((file) => attachFile(file));
      return;
    }
  }

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/mail', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toUserId,
          subject,
          body,
          imageDataUrl,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Could not send mail');
        return;
      }
      onSent?.();
      onClose();
    } catch {
      setError('Could not send mail');
    } finally {
      setSending(false);
    }
  }

  const dialog = (
    <dialog
      ref={dialogRef}
      className="w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-[var(--color-surface-raised)] p-0 text-[var(--color-text)] shadow-2xl backdrop:bg-black/60"
      aria-labelledby={`${uid}-title`}
      onClick={onBackdropClick}
      onClose={onClose}
      onPaste={onPaste}
    >
      <form className="flex flex-col gap-3 p-5" onSubmit={onSubmit}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={`${uid}-title`} className="text-base font-semibold">
              Compose Sorye Mail
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Delivers in this workspace only — not a public mailbox.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div>
          <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-to`}>
            To
          </label>
          <select
            id={`${uid}-to`}
            className={FIELD_CLASS}
            value={toUserId}
            onChange={(event) => setToUserId(event.target.value)}
            required
          >
            {recipients.length === 0 ? (
              <option value="">No other members in this workspace</option>
            ) : (
              recipients.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName} · {member.generatedAddress}
                </option>
              ))
            )}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-subject`}>
            Subject
          </label>
          <input
            id={`${uid}-subject`}
            className={FIELD_CLASS}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            required
            maxLength={MAIL_SUBJECT_MAX}
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-body`}>
            Message
          </label>
          <textarea
            id={`${uid}-body`}
            className={`${FIELD_CLASS} min-h-32 resize-y`}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={MAIL_BODY_MAX}
            placeholder="Write a message. Paste a screenshot to attach."
          />
        </div>

        {imageDataUrl ? (
          <figure className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
            <img
              src={imageDataUrl}
              alt="Attachment"
              className="max-h-48 w-full object-contain"
            />
            <figcaption className="flex items-center justify-between px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
              Attached image
              <button
                type="button"
                className="rounded px-2 py-0.5 hover:bg-white/10 hover:text-[var(--color-text)]"
                onClick={() => setImageDataUrl(undefined)}
              >
                Remove
              </button>
            </figcaption>
          </figure>
        ) : null}

        {error ? (
          <p className="text-xs text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(event) => void attachFile(event.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
              onClick={() => fileRef.current?.click()}
              disabled={attaching}
            >
              {attaching ? 'Attaching…' : 'Attach image'}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-xs text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-medium text-[var(--color-surface)] transition hover:brightness-110 disabled:opacity-50"
              disabled={sending || !toUserId}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );

  if (!mounted) return null;
  return createPortal(dialog, document.body);
}
