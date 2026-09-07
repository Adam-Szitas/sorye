'use client';

import {
  HUB_MAIL_COMPOSE_EVENT,
  MAIL_PERSONAL_EMAIL_MAX,
  type MailBootstrap,
  type MailComposeDetail,
  type MailMessage,
} from '@sorye/types';
import { useCallback, useEffect, useId, useState } from 'react';
import { MailComposeDialog } from '@/components/mail-compose-dialog';

type Folder = 'inbox' | 'sent';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]/50';

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MessageReadingPane({
  message,
  folder,
}: {
  message: MailMessage;
  folder: Folder;
}) {
  const peer = folder === 'inbox' ? message.fromName : message.toName;
  const address = folder === 'inbox' ? message.fromAddress : message.toAddress;
  return (
    <article className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            {message.subject}
          </h2>
          <p className="mt-1 truncate text-xs text-[var(--color-text-muted)]">
            {folder === 'inbox' ? 'From' : 'To'} {peer} · {address}
          </p>
        </div>
        <time className="text-[11px] text-[var(--color-text-muted)]">
          {formatWhen(message.createdAt)}
        </time>
      </header>
      {message.imageDataUrl ? (
        <figure className="mt-4 overflow-hidden rounded-xl border border-white/8 bg-black/30">
          <img
            src={message.imageDataUrl}
            alt=""
            className="max-h-64 w-full object-contain"
          />
        </figure>
      ) : null}
      {message.body ? (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
          {message.body}
        </p>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          No message body.
        </p>
      )}
    </article>
  );
}

export function AppMail() {
  const uid = useId();
  const [data, setData] = useState<MailBootstrap | null>(null);
  const [folder, setFolder] = useState<Folder>('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<MailComposeDetail | null>(
    null,
  );
  const [personalEmail, setPersonalEmail] = useState('');
  const [notifyMessenger, setNotifyMessenger] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/mail', { credentials: 'include' });
    const next = (await res.json().catch(() => ({}))) as MailBootstrap & {
      error?: string;
    };
    if (!res.ok) {
      throw new Error(next.error ?? 'Could not load Mail');
    }
    setData(next);
    setPersonalEmail(next.profile.personalEmail);
    setNotifyMessenger(next.profile.notifyMessenger);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load Mail');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  function openCompose(initial?: MailComposeDetail) {
    setComposeInitial(initial ?? null);
    setComposeOpen(true);
  }

  async function copyAddress() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.profile.generatedAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice('Could not copy address');
    }
  }

  async function saveSettings() {
    if (!data || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/mail', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalEmail, notifyMessenger }),
      });
      const next = (await res.json().catch(() => ({}))) as {
        error?: string;
        profile?: MailBootstrap['profile'];
      };
      if (!res.ok || !next.profile) {
        setError(next.error ?? 'Could not save settings');
        return;
      }
      setData({ ...data, profile: next.profile });
      setPersonalEmail(next.profile.personalEmail);
      setNotifyMessenger(next.profile.notifyMessenger);
      setNotice('Settings saved for this workspace only.');
    } catch {
      setError('Could not save settings');
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-text-muted)]">
        {error ?? 'Loading Mail…'}
      </div>
    );
  }

  const list = folder === 'sent' ? data.sent : data.inbox;
  const selected = list.find((message) => message.id === selectedId) ?? null;

  return (
    <div className="@container flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Mail</h1>
          <p className="truncate font-mono text-xs text-[var(--color-accent)]">
            {data.profile.generatedAddress}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-white/8 px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
            onClick={() => void copyAddress()}
          >
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              settingsOpen
                ? 'bg-white/12 text-[var(--color-text)]'
                : 'bg-white/8 text-[var(--color-text-muted)] hover:bg-white/12 hover:text-[var(--color-text)]'
            }`}
            aria-expanded={settingsOpen}
            aria-controls={`${uid}-settings`}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            Settings
          </button>
          <button
            type="button"
            className="rounded-lg bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--color-surface)] transition hover:brightness-110"
            onClick={() =>
              openCompose(data.draft ? { ...data.draft } : undefined)
            }
          >
            Compose
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <section
          id={`${uid}-settings`}
          className="shrink-0 border-b border-white/8 bg-black/15 px-4 py-4 sm:px-5"
          aria-label="Mail settings"
        >
          <form
            className="mx-auto flex max-w-lg flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSettings();
            }}
          >
            <p className="text-xs text-[var(--color-text-muted)]">
              Workspace mailbox only — Hub does not send or receive internet
              email.
            </p>
            <div>
              <label className="text-sm font-medium" htmlFor={`${uid}-generated`}>
                Sorye Mail address
              </label>
              <input
                id={`${uid}-generated`}
                className={`${FIELD_CLASS} text-[var(--color-text-muted)]`}
                value={data.profile.generatedAddress}
                readOnly
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor={`${uid}-personal`}>
                Personal email (optional)
              </label>
              <input
                id={`${uid}-personal`}
                className={FIELD_CLASS}
                type="email"
                autoComplete="email"
                inputMode="email"
                maxLength={MAIL_PERSONAL_EMAIL_MAX}
                value={personalEmail}
                onChange={(event) => setPersonalEmail(event.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Stored on your profile here only. Not shown to other workspaces.
              </p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={notifyMessenger}
                onChange={(event) => setNotifyMessenger(event.target.checked)}
              />
              <span>
                Also notify Messenger
                <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                  Posts a short note to #events when you send.
                </span>
              </span>
            </label>
            <button
              type="submit"
              className="self-start rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-xs font-medium text-[var(--color-surface)] transition hover:brightness-110 disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </form>
        </section>
      ) : null}

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

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(12rem,40%)_minmax(0,1fr)] @min-[36rem]:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] @min-[36rem]:grid-rows-none">
        <section
          className="flex min-h-0 min-w-0 flex-col border-b border-white/8 @min-[36rem]:border-b-0 @min-[36rem]:border-r"
          aria-label="Message list"
        >
          <nav
            className="flex shrink-0 gap-1 px-3 py-2"
            aria-label="Mail folders"
          >
            {(
              [
                ['inbox', `Inbox (${data.inbox.length})`],
                ['sent', `Sent (${data.sent.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setFolder(id);
                  if (
                    !((id === 'sent' ? data.sent : data.inbox)).some(
                      (message) => message.id === selectedId,
                    )
                  ) {
                    setSelectedId(null);
                  }
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  folder === id
                    ? 'bg-white/12 text-[var(--color-text)]'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
                aria-current={folder === id ? 'page' : undefined}
              >
                {label}
              </button>
            ))}
          </nav>

          {list.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--color-text-muted)]">
              {folder === 'inbox'
                ? 'No incoming mail yet.'
                : 'Nothing sent yet.'}
            </p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {list.map((message) => {
                const peer =
                  folder === 'inbox' ? message.fromName : message.toName;
                const active = message.id === selected?.id;
                return (
                  <li key={message.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(message.id)}
                      className={`flex w-full flex-col gap-0.5 border-t border-white/6 px-4 py-3 text-left transition ${
                        active
                          ? 'bg-white/10'
                          : 'hover:bg-white/6'
                      }`}
                      aria-current={active ? 'true' : undefined}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {message.subject}
                        </span>
                        <time className="shrink-0 text-[10px] text-[var(--color-text-muted)]">
                          {formatWhen(message.createdAt)}
                        </time>
                      </span>
                      <span className="truncate text-xs text-[var(--color-text-muted)]">
                        {folder === 'inbox' ? 'From' : 'To'} {peer}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section
          className="flex min-h-0 min-w-0 flex-col"
          aria-label="Message"
        >
          {selected ? (
            <MessageReadingPane message={selected} folder={folder} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                Select a message
              </p>
              <button
                type="button"
                className="rounded-lg bg-white/8 px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition hover:bg-white/12 hover:text-[var(--color-text)]"
                onClick={() =>
                  openCompose(data.draft ? { ...data.draft } : undefined)
                }
              >
                Compose
              </button>
            </div>
          )}
        </section>
      </div>

      <MailComposeDialog
        open={composeOpen}
        members={data.members}
        currentUserId={data.profile.userId}
        initial={composeInitial}
        onClose={() => setComposeOpen(false)}
        onSent={() => {
          setNotice('Sent in-workspace. Not delivered to the public internet.');
          setFolder('sent');
          void load().then((next) => {
            const latest = next?.sent[0];
            if (latest) setSelectedId(latest.id);
          });
        }}
      />
    </div>
  );
}

export function MailComposeHost() {
  const [data, setData] = useState<MailBootstrap | null>(null);
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<MailComposeDetail | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/mail', { credentials: 'include' });
    if (!res.ok) return null;
    const next = (await res.json()) as MailBootstrap;
    setData(next);
    return next;
  }, []);

  useEffect(() => {
    function onCompose(event: Event) {
      const detail = (event as CustomEvent<MailComposeDetail>).detail ?? {};
      setInitial(detail);
      void load().then((next) => {
        if (next) setOpen(true);
      });
    }
    window.addEventListener(HUB_MAIL_COMPOSE_EVENT, onCompose);
    return () => window.removeEventListener(HUB_MAIL_COMPOSE_EVENT, onCompose);
  }, [load]);

  if (!open) return null;

  return (
    <MailComposeDialog
      open={open}
      members={data?.members ?? []}
      currentUserId={data?.profile.userId ?? ''}
      initial={initial}
      onClose={() => setOpen(false)}
      onSent={() => void load()}
    />
  );
}
