'use client';

import {
  MAIL_ACCOUNT_LABEL_MAX,
  MAIL_ACCOUNT_PASSWORD_MAX,
  MAIL_PERSONAL_EMAIL_MAX,
  MAIL_PROVIDER_LABELS,
  type MailAccountProvider,
  type MailConnectedAccount,
} from '@sorye/types';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]/50';

const PROVIDERS: MailAccountProvider[] = ['gmail', 'outlook', 'imap'];

function supportsClosedBy(): boolean {
  return (
    typeof HTMLDialogElement !== 'undefined' &&
    'closedBy' in HTMLDialogElement.prototype
  );
}

export function MailAccountDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (account: MailConnectedAccount) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [mounted, setMounted] = useState(false);
  const [provider, setProvider] = useState<MailAccountProvider>('gmail');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
      setError(null);
      setProvider('gmail');
      setEmail('');
      setPassword('');
      setShowPassword(false);
      setLabel('');
      setUsername('');
      setImapHost('');
      setImapPort('993');
      setSmtpHost('');
      setSmtpPort('465');
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, mounted]);

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
    if (!form.reportValidity() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        provider,
        email,
        password,
        label: label.trim() || undefined,
        username: username.trim() || undefined,
      };
      if (provider === 'imap') {
        payload.imap = {
          host: imapHost.trim(),
          port: Number(imapPort),
          secure: Number(imapPort) === 993,
        };
        payload.smtp = {
          host: smtpHost.trim(),
          port: Number(smtpPort),
          secure: Number(smtpPort) === 465,
        };
      }
      const res = await fetch('/api/mail/accounts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        account?: MailConnectedAccount;
      };
      if (!res.ok || !data.account) {
        setError(data.error ?? 'Could not add account');
        return;
      }
      setPassword('');
      onAdded(data.account);
      onClose();
    } catch {
      setError('Could not add account');
    } finally {
      setSaving(false);
    }
  }

  const dialog = (
    <dialog
      ref={dialogRef}
      className="w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-white/10 bg-[var(--color-surface-raised)] p-0 text-[var(--color-text)] shadow-2xl backdrop:bg-black/60"
      aria-labelledby={`${uid}-title`}
      onClick={onBackdropClick}
      onClose={onClose}
    >
      <form className="flex flex-col gap-3 p-5" onSubmit={onSubmit} noValidate={false}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={`${uid}-title`} className="text-base font-semibold">
              Add email account
            </h2>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Connect Gmail, Outlook, or any IMAP inbox. Hub fetches and
              sends through your provider — this is not a public mail server.
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

        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <legend className="mb-1 text-[11px] font-medium text-[var(--color-text-muted)]">
            Provider
          </legend>
          {PROVIDERS.map((id) => (
            <label
              key={id}
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 py-2 text-xs font-medium transition ${
                provider === id
                  ? 'border-[var(--color-accent)]/50 bg-white/10'
                  : 'border-white/10 bg-black/20 text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              <input
                type="radio"
                name={`${uid}-provider`}
                className="accent-[var(--color-accent)]"
                checked={provider === id}
                onChange={() => setProvider(id)}
              />
              {MAIL_PROVIDER_LABELS[id]}
            </label>
          ))}
        </fieldset>

        <p className="text-xs text-[var(--color-text-muted)]">
          {provider === 'gmail'
            ? 'Gmail needs an App Password (Google Account → Security → 2-Step Verification → App passwords). OAuth sign-in is coming later.'
            : provider === 'outlook'
              ? 'Outlook / Hotmail typically needs an App Password when two-step verification is on. OAuth sign-in is coming later.'
              : 'Enter your IMAP and SMTP hosts. Use an app password when the provider offers one.'}
        </p>

        <div>
          <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-email`}>
            Email
          </label>
          <input
            id={`${uid}-email`}
            className={FIELD_CLASS}
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            maxLength={MAIL_PERSONAL_EMAIL_MAX}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-password`}>
            App password
          </label>
          <div className="flex gap-2">
            <input
              id={`${uid}-password`}
              className={FIELD_CLASS}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              maxLength={MAIL_ACCOUNT_PASSWORD_MAX}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="mt-1 shrink-0 rounded-lg px-2 text-xs text-[var(--color-text-muted)] hover:bg-white/10 hover:text-[var(--color-text)]"
              aria-pressed={showPassword}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((open) => !open)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-label`}>
            Label (optional)
          </label>
          <input
            id={`${uid}-label`}
            className={FIELD_CLASS}
            maxLength={MAIL_ACCOUNT_LABEL_MAX}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={MAIL_PROVIDER_LABELS[provider]}
          />
        </div>

        {provider === 'imap' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-imap-host`}>
                IMAP host
              </label>
              <input
                id={`${uid}-imap-host`}
                className={FIELD_CLASS}
                required
                value={imapHost}
                onChange={(event) => setImapHost(event.target.value)}
                placeholder="imap.example.com"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-imap-port`}>
                IMAP port
              </label>
              <input
                id={`${uid}-imap-port`}
                className={FIELD_CLASS}
                inputMode="numeric"
                required
                value={imapPort}
                onChange={(event) => setImapPort(event.target.value)}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-smtp-host`}>
                SMTP host
              </label>
              <input
                id={`${uid}-smtp-host`}
                className={FIELD_CLASS}
                required
                value={smtpHost}
                onChange={(event) => setSmtpHost(event.target.value)}
                placeholder="smtp.example.com"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-smtp-port`}>
                SMTP port
              </label>
              <input
                id={`${uid}-smtp-port`}
                className={FIELD_CLASS}
                inputMode="numeric"
                required
                value={smtpPort}
                onChange={(event) => setSmtpPort(event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-medium text-[var(--color-text-muted)]" htmlFor={`${uid}-username`}>
                Username (if different from email)
              </label>
              <input
                id={`${uid}-username`}
                className={FIELD_CLASS}
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="text-xs text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-1 flex justify-end gap-2">
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
            disabled={saving}
          >
            {saving ? 'Testing connection…' : 'Test and save'}
          </button>
        </div>
      </form>
    </dialog>
  );

  if (!mounted) return null;
  return createPortal(dialog, document.body);
}
